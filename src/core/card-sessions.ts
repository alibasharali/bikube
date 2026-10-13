/**
 * Each card's terminal (#4 D3, D9; #5 D6, D7): every start gets a fresh screen and shell session
 * in main, discarded once the shell exits (Stopped), plus the card's status. Plain TS: the
 * renderer injects the terminal bridge and a factory for screens (xterm in the app, fakes in
 * tests), so views can come and go while a running card's screen keeps receiving output.
 */
import type { TerminalApi, TerminalExit } from '../shared/api'
import { cardStatus, lastOutputLine, type CardRunState, type CardStatus } from './card-status'
import { startLine, type StartupState } from './startup-command'

/** What the registry needs from a terminal emulator. */
export interface CardScreen {
  readonly cols: number
  readonly rows: number
  /** Feeds shell output; `done` runs once it is on the screen. */
  write(data: string, done?: () => void): void
  /** Keystrokes typed into the screen. */
  onInput(listener: (data: string) => void): void
  onResize(listener: (size: { cols: number; rows: number }) => void): void
  /** The visible screen's lines (bottom of scrollback) and the cursor's row in them. */
  screen(): { lines: string[]; cursorRow: number }
  /** Stops taking input: the shell couldn't start (#5 D8). */
  setReadOnly(): void
  dispose(): void
}

export interface CardRef {
  id: string
  directory: string
}

/** A card as it is when it starts: its startup command is read then (#5 D7). */
export interface StartingCard extends CardRef, StartupState {}

/** The board shows a card's status at most about 4 times a second (D9). */
export const STATUS_INTERVAL_MS = 250

interface Entry<S> {
  /** Null once the shell has exited: a Stopped card has no screen (#5 D6). */
  screen: S | null
  sessionId: string | null
  state: CardRunState
  /** Set by `board status` (#9 D8); empty when none. Cleared whenever the state changes. */
  agentStatus: string
  status: CardStatus
  listeners: Set<() => void>
  /** Pending throttle timer; `dirty` means output landed since the last status update. */
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  disposed: boolean
  /** Closed while its shell was starting: killed as soon as the session arrives (#7 D2). */
  closing: boolean
}

export class CardSessions<S extends CardScreen> {
  private readonly entries = new Map<string, Entry<S>>()
  private readonly bySession = new Map<string, Entry<S>>()
  /** Spawns awaiting their reply; while any are, events for unknown sessions are kept. */
  private starting = 0
  private readonly early = new Map<string, { data: string[]; exit?: TerminalExit }>()

  constructor(
    private readonly api: TerminalApi,
    private readonly createScreen: (cardId: string) => S
  ) {
    api.onData((id, data) => {
      const entry = this.bySession.get(id)
      if (entry) this.output(entry, data)
      else if (this.starting > 0) this.earlyFor(id).data.push(data)
    })
    api.onExit((exit) => {
      const entry = this.bySession.get(exit.id)
      if (entry) this.exited(entry, exit)
      else if (this.starting > 0) this.earlyFor(exit.id).exit = exit
    })
  }

  /**
   * Starts the card's shell in its directory on a new, empty screen (#5 D7): a card with no
   * terminal yet, a Stopped one, or one that couldn't start (a retry, #5 D8). A running card
   * (or one whose shell is starting) is left as it is (#4 D10).
   *
   * Right after a successful spawn it types the card's start line and Enter, before any
   * keystroke (#5 D3); `onClaudeStarted` runs when that was Claude Code's first start (#5 D5).
   */
  start(card: StartingCard, onClaudeStarted?: () => void): void {
    const existing = this.entries.get(card.id)
    if (existing?.state.kind === 'running') return
    const screen = this.createScreen(card.id)
    const state: CardRunState = { kind: 'running' }
    const entry: Entry<S> = existing ?? {
      screen,
      sessionId: null,
      state,
      agentStatus: '',
      status: cardStatus(state, ''),
      listeners: new Set(),
      timer: null,
      dirty: false,
      disposed: false,
      closing: false
    }
    if (existing) {
      // The old screen is gone already when Stopped; a failed one still shows its reason.
      existing.screen?.dispose()
      existing.screen = screen
    } else {
      this.entries.set(card.id, entry)
    }
    screen.onInput((data) => {
      if (entry.screen === screen && entry.sessionId && entry.state.kind === 'running')
        this.api.write(entry.sessionId, data)
    })
    screen.onResize(({ cols, rows }) => {
      if (entry.screen === screen && entry.sessionId) this.api.resize(entry.sessionId, cols, rows)
    })
    const { cols, rows } = screen
    const line = startLine(card)
    // Each start owns its screen; a reply for an older start, or after dispose, is stale.
    const current = (): boolean => !entry.disposed && entry.screen === screen
    const failed = (reason: string): void => {
      if (!current()) return
      screen.write(`Couldn't start: ${reason}\r\n`)
      this.setState(entry, { kind: 'failed', reason })
    }
    entry.closing = false
    this.setState(entry, state)
    this.starting++
    void this.api
      .spawn(cols, rows, card.directory, card.id)
      .then(
        (result) => {
          if (!result.ok) return failed(result.reason)
          if (!current()) return this.api.kill(result.id)
          entry.sessionId = result.id
          this.bySession.set(result.id, entry)
          // The view may have fitted the screen while the shell was starting.
          if (screen.cols !== cols || screen.rows !== rows) {
            this.api.resize(result.id, screen.cols, screen.rows)
          }
          const early = this.early.get(result.id)
          if (entry.closing) this.api.kill(result.id)
          else if (line !== null && !early?.exit) {
            this.api.write(result.id, `${line}\r`)
            if (card.startup.kind === 'claude' && !card.claudeStarted) onClaudeStarted?.()
          }
          early?.data.forEach((data) => this.output(entry, data))
          if (early?.exit) this.exited(entry, early.exit)
        },
        (error: unknown) => failed(error instanceof Error ? error.message : String(error))
      )
      .finally(() => {
        if (--this.starting === 0) this.early.clear()
      })
  }

  /** Running, Stopped or couldn't start; undefined for an unknown card. */
  runState(cardId: string): CardRunState | undefined {
    return this.entries.get(cardId)?.state
  }

  /** The card's screen; undefined for an unknown or Stopped card. */
  screen(cardId: string): S | undefined {
    return this.entries.get(cardId)?.screen ?? undefined
  }

  /** The card's status; the same object until it changes, for `useSyncExternalStore`. */
  status(cardId: string): CardStatus | undefined {
    return this.entries.get(cardId)?.status
  }

  /**
   * Sets the running card's agent status, already cleaned (`cleanAgentStatus`); empty clears it
   * (#9 D8). Returns false, changing nothing, for a card that isn't running.
   */
  setAgentStatus(cardId: string, text: string): boolean {
    const entry = this.entries.get(cardId)
    if (entry?.state.kind !== 'running') return false
    entry.agentStatus = text
    this.refresh(entry)
    return true
  }

  /** Called when the card's status changes. Returns an unsubscribe function. */
  subscribe(cardId: string, listener: () => void): () => void {
    const entry = this.entries.get(cardId)
    if (!entry) return () => {}
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  /**
   * Closes a running card (#7 D1, D2): kills its shell session and keeps the card, which stays
   * Running until main reports the exit and then turns Stopped like a shell that exits by
   * itself. While its shell is starting, the kill is sent once the session arrives, and its
   * start line isn't typed. A Stopped card, one that couldn't start, or an unknown one is left
   * as it is.
   */
  close(cardId: string): void {
    const entry = this.entries.get(cardId)
    if (entry?.state.kind !== 'running') return
    if (entry.sessionId) this.api.kill(entry.sessionId)
    else entry.closing = true
  }

  /** Stops the card's process if it runs, frees its screen and forgets the card. */
  dispose(cardId: string): void {
    const entry = this.entries.get(cardId)
    if (!entry) return
    entry.disposed = true
    this.entries.delete(cardId)
    if (entry.sessionId) {
      this.bySession.delete(entry.sessionId)
      this.api.kill(entry.sessionId)
    }
    if (entry.timer) clearTimeout(entry.timer)
    entry.listeners.clear()
    entry.screen?.dispose()
  }

  private earlyFor(id: string): { data: string[]; exit?: TerminalExit } {
    let early = this.early.get(id)
    if (!early) this.early.set(id, (early = { data: [] }))
    return early
  }

  private output(entry: Entry<S>, data: string): void {
    entry.screen?.write(data, () => {
      if (!entry.disposed) this.outputLanded(entry)
    })
  }

  /** Stopped: the old screen and its scrollback are discarded (#5 D6). */
  private exited(entry: Entry<S>, { id }: TerminalExit): void {
    this.bySession.delete(id)
    entry.sessionId = null
    entry.screen?.dispose()
    entry.screen = null
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.dirty = false
    this.setState(entry, { kind: 'stopped' })
  }

  /** Leading-edge update, then at most one more per interval while output keeps coming. */
  private outputLanded(entry: Entry<S>): void {
    if (entry.timer) {
      entry.dirty = true
      return
    }
    this.refresh(entry)
    const tick = (): void => {
      if (!entry.dirty) {
        entry.timer = null
        return
      }
      entry.dirty = false
      this.refresh(entry)
      entry.timer = setTimeout(tick, STATUS_INTERVAL_MS)
    }
    entry.timer = setTimeout(tick, STATUS_INTERVAL_MS)
  }

  /** A process state change shows at once, outside the output throttle. */
  private setState(entry: Entry<S>, state: CardRunState): void {
    entry.state = state
    // A start, a stop and a failed start all clear the agent status (#9 D8).
    entry.agentStatus = ''
    if (state.kind === 'failed') entry.screen?.setReadOnly()
    this.refresh(entry)
  }

  /** Recomputes the status from the screen and notifies when it changed. */
  private refresh(entry: Entry<S>): void {
    const { lines, cursorRow } = entry.screen?.screen() ?? { lines: [], cursorRow: 0 }
    const next = cardStatus(entry.state, lastOutputLine(lines, cursorRow), entry.agentStatus)
    if (next.label === entry.status.label && next.lastLine === entry.status.lastLine) return
    entry.status = next
    entry.listeners.forEach((l) => l())
  }
}
