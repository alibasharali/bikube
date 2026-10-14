/**
 * Each card's terminal (#4 D3, D9; #5 D6, D7): every start gets a fresh screen and shell session
 * in main, discarded once the shell exits (Stopped), plus the card's status. Plain TS: the
 * renderer injects the terminal bridge and a factory for screens (xterm in the app, fakes in
 * tests), so views can come and go while a running card's screen keeps receiving output.
 */
import type { TerminalApi, TerminalExit } from '../shared/api'
import { SessionRouter } from './session-router'
import { cardStatus, lastOutputLine, type CardRunState, type CardStatus } from './card-status'
import { readyWatcher } from './ready-marker'
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
  /** The SSH host the card runs on (#12 D1); absent for a local card. */
  host?: string
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
  /** Closed during this start (#7): its stop is never SSH failed (#12 D7). */
  closed: boolean
  /** The current start's SSH host; undefined for a local card (#12 D5). */
  host: string | undefined
  /** Fed each output chunk while an SSH card's start line waits for the ready marker (#12 D6). */
  watch: ((data: string) => void) | null
}

export class CardSessions<S extends CardScreen> {
  private readonly entries = new Map<string, Entry<S>>()
  private readonly endedListeners: ((cardId: string) => void)[] = []

  /** `router` is shared with the cards' extra panes (#11), or a new one over `api`. */
  constructor(
    private readonly api: TerminalApi,
    private readonly createScreen: (cardId: string) => S,
    private readonly router: SessionRouter = new SessionRouter(api)
  ) {}

  /**
   * Starts the card's shell in its directory on a new, empty screen (#5 D7): a card with no
   * terminal yet, a Stopped one, or one that couldn't start (a retry, #5 D8). A running card
   * (or one whose shell is starting) is left as it is (#4 D10).
   *
   * Right after a successful spawn it types the card's start line and Enter, before any
   * keystroke (#5 D3); `onClaudeStarted` runs when that was Claude Code's first start (#5 D5).
   * An SSH card (#12 D5) spawns with its host, and its start line is typed once, when the ready
   * marker first appears in its output (#12 D6); never if its session ends before.
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
      closing: false,
      closed: false,
      host: card.host,
      watch: null
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
      this.endedListeners.forEach((listener) => listener(card.id))
    }
    entry.closing = false
    entry.closed = false
    entry.host = card.host
    entry.watch = null
    this.setState(entry, state)
    const sessionStarted = (id: string): void => {
      if (line === null) return
      this.api.write(id, `${line}\r`)
      if (card.startup.kind === 'claude' && !card.claudeStarted) onClaudeStarted?.()
    }
    this.router.spawn(
      cols,
      rows,
      card.directory,
      card.id,
      (result) => {
        if (!result.ok) return failed(result.reason)
        if (!current()) return this.api.kill(result.id)
        entry.sessionId = result.id
        const early = this.router.adopt(result.id, {
          output: (data) => this.output(entry, data),
          exited: (exit) => this.exited(card.id, entry, exit)
        })
        // The view may have fitted the screen while the shell was starting.
        if (screen.cols !== cols || screen.rows !== rows) {
          this.api.resize(result.id, screen.cols, screen.rows)
        }
        if (entry.closing) this.api.kill(result.id)
        else if (line !== null && !early.exit) {
          if (card.host === undefined) sessionStarted(result.id)
          else {
            const seen = readyWatcher()
            entry.watch = (data) => {
              if (!seen(data)) return
              entry.watch = null
              sessionStarted(result.id)
            }
          }
        }
        early.data.forEach((data) => this.output(entry, data))
        if (early.exit) this.exited(card.id, entry, early.exit)
      },
      card.host ?? null
    )
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

  /**
   * Called with a card's id each time a start of it ends: its shell stops for any reason (it
   * exits, or is Closed) and the card is Stopped, or its shell couldn't start (#5 D8); not when
   * the card is disposed. The card's extra panes end with it (#11 D1, D6).
   */
  onEnded(listener: (cardId: string) => void): void {
    this.endedListeners.push(listener)
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
    entry.closed = true
    entry.watch = null
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
      this.router.release(entry.sessionId)
      this.api.kill(entry.sessionId)
    }
    if (entry.timer) clearTimeout(entry.timer)
    entry.listeners.clear()
    entry.screen?.dispose()
  }

  private output(entry: Entry<S>, data: string): void {
    entry.watch?.(data)
    entry.screen?.write(data, () => {
      if (!entry.disposed) this.outputLanded(entry)
    })
  }

  /**
   * Stopped: the old screen and its scrollback are discarded (#5 D6). An SSH card whose shell
   * exited by itself with `ssh`'s 255 is SSH failed with its last output line (#12 D7), read once
   * the screen has parsed everything written to it.
   */
  private exited(cardId: string, entry: Entry<S>, { id, exitCode }: TerminalExit): void {
    this.router.release(id)
    entry.sessionId = null
    entry.watch = null
    const screen = entry.screen
    if (entry.host === undefined || exitCode !== 255 || entry.closed || !screen) {
      return this.stopped(cardId, entry, { kind: 'stopped' })
    }
    screen.write('', () => {
      if (entry.disposed || entry.screen !== screen) return
      const { lines, cursorRow } = screen.screen()
      this.stopped(cardId, entry, { kind: 'stopped', sshFailed: lastOutputLine(lines, cursorRow) })
    })
  }

  private stopped(cardId: string, entry: Entry<S>, state: CardRunState): void {
    entry.screen?.dispose()
    entry.screen = null
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.dirty = false
    this.setState(entry, state)
    this.endedListeners.forEach((listener) => listener(cardId))
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
