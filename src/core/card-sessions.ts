/**
 * Each card's terminal (#4 D3, D9; #5 D6, D7): every start gets a fresh screen and shell session
 * in main, discarded once the shell exits (Stopped), plus the card's status. Plain TS: the
 * renderer injects the terminal bridge and a factory for screens (xterm in the app, fakes in
 * tests), so views can come and go while a running card's screen keeps receiving output.
 */
import type { TerminalApi, TerminalExit } from '../shared/api'
import type { Activity } from './activity'
import { SessionRouter } from './session-router'
import { cardStatus, lastOutputLine, type CardRunState, type CardStatus } from './card-status'
import { readyWatcher } from './ready-marker'
import {
  firstStart,
  setupLine,
  startLine,
  type FirstStart,
  type StartupState
} from './startup-command'

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

/**
 * A card's setup in this start (#39 D5): `running` once its setup line is typed until `board
 * setup` answers, `failed` after `board setup . failed`. Runtime only; null when none.
 */
export type SetupState = 'running' | 'failed'

/** The board shows a card's status at most about 4 times a second (D9). */
export const STATUS_INTERVAL_MS = 250

/** The most characters typed while a shell is starting that are kept for it; more are dropped. */
export const MAX_TYPEAHEAD_CHARS = 64 * 1024

interface Entry<S> {
  cardId: string
  /** Null once the shell has exited: a Stopped card has no screen (#5 D6). */
  screen: S | null
  sessionId: string | null
  state: CardRunState
  /** Set by `board status` (#9 D8); empty when none. Cleared whenever the state changes. */
  agentStatus: string
  /** Set by `board activity` (#31 D12); null when none. Cleared whenever the state changes. */
  activity: Activity | null
  /** The setup's state in this start (#39 D5); null when none. Cleared whenever the state changes. */
  setup: SetupState | null
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
  /** Listeners subscribed to a card not started yet, attached at its first start. */
  private readonly early = new Map<string, Set<() => void>>()
  private readonly endedListeners: ((cardId: string) => void)[] = []
  private readonly activityListeners: ((cardId: string, activity: Activity | null) => void)[] = []
  private readonly setupListeners: ((cardId: string, setup: SetupState | null) => void)[] = []

  /**
   * `router` is shared with the cards' extra panes (#11), or a new one over `api`. `defer` runs
   * each card's spawn: the app defers it past the current task, so the view that opens the card
   * has fitted its new screen and the shell starts at the size the user sees (#22 D1); by
   * default the spawn runs at once.
   */
  constructor(
    private readonly api: TerminalApi,
    private readonly createScreen: (cardId: string) => S,
    private readonly router: SessionRouter = new SessionRouter(api),
    private readonly defer: (spawn: () => void) => void = (spawn) => spawn()
  ) {}

  /**
   * Starts the card's shell in its directory on a new, empty screen (#5 D7): a card with no
   * terminal yet, a Stopped one, or one that couldn't start (a retry, #5 D8). A running card
   * (or one whose shell is starting) is left as it is (#4 D10).
   *
   * Right after a successful spawn it types the card's start line and Enter, before any
   * keystroke (#5 D3); `onFirstStart` runs with Claude Code's or the preset's kind when that was
   * its first start on this card (#5 D5, #21 D3). A local card with a pending setup (#39 D3) gets
   * the setup line instead, records no first start, and its setup is `running`.
   * An SSH card (#12 D5) spawns with its host, and its start line is typed once, when the ready
   * marker first appears in its output (#12 D6); never if its session ends before.
   */
  start(card: StartingCard, onFirstStart?: (kind: FirstStart) => void): void {
    const existing = this.entries.get(card.id)
    if (existing?.state.kind === 'running') return
    const screen = this.createScreen(card.id)
    const state: CardRunState = { kind: 'running' }
    const entry: Entry<S> = existing ?? {
      cardId: card.id,
      screen,
      sessionId: null,
      state,
      agentStatus: '',
      activity: null,
      setup: null,
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
      // Subscribed before its first start (a shell's chip, shown before it autostarts): told now.
      const early = this.early.get(card.id)
      if (early) {
        this.early.delete(card.id)
        early.forEach((l) => entry.listeners.add(l))
        early.forEach((l) => l())
      }
    }
    // Typed while a local shell is starting: written once its session arrives, null after that
    // (#25 D10). An SSH card keeps none: early input could answer ssh's own prompts (#12 D6).
    let typeahead: string[] | null = card.host === undefined ? [] : null
    let typeaheadChars = 0
    screen.onInput((data) => {
      if (entry.screen !== screen || entry.state.kind !== 'running') return
      if (entry.sessionId) return this.api.write(entry.sessionId, data)
      if (!typeahead || typeaheadChars + data.length > MAX_TYPEAHEAD_CHARS) return
      typeahead.push(data)
      typeaheadChars += data.length
    })
    screen.onResize(({ cols, rows }) => {
      if (entry.screen === screen && entry.sessionId) this.api.resize(entry.sessionId, cols, rows)
    })
    const setup = card.host === undefined && card.setup ? card.setup : null
    const line = setup !== null ? setupLine(setup) : startLine(card)
    const first = setup !== null ? null : firstStart(card)
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
    if (setup !== null) this.setSetup(entry, 'running')
    const sessionStarted = (id: string): void => {
      if (line === null) return
      this.api.write(id, `${line}\r`)
      if (first !== null) onFirstStart?.(first)
    }
    // Spawned at the screen's size when the deferral ends (#22 D1). A card closed or deleted
    // meanwhile is killed once its session arrives, like one closed while starting (#22 D2).
    this.defer(() => {
      const { cols, rows } = screen
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
            output: (data, parsed) => this.output(entry, data, parsed),
            exited: (exit) => this.exited(card.id, entry, exit)
          })
          // The view may have fitted the screen while the shell was starting.
          if (screen.cols !== cols || screen.rows !== rows) {
            this.api.resize(result.id, screen.cols, screen.rows)
          }
          if (entry.closing) this.api.kill(result.id)
          else if (!early.exit) {
            // A local card's start line goes first; an SSH card's waits for the marker (#12 D6).
            if (line !== null && card.host === undefined) sessionStarted(result.id)
            typeahead?.forEach((data) => this.api.write(result.id, data))
            if (line !== null && card.host !== undefined) {
              const seen = readyWatcher()
              entry.watch = (data) => {
                if (!seen(data)) return
                entry.watch = null
                sessionStarted(result.id)
              }
            }
          }
          typeahead = null
          early.data.forEach((data) =>
            this.output(entry, data, this.router.ackWhenParsed(result.id, data))
          )
          if (early.exit) this.exited(card.id, entry, early.exit)
        },
        card.host ?? null
      )
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

  /**
   * Sets the running card's activity; null clears it (#31 D12). Returns false, changing nothing,
   * for a card that isn't running.
   */
  setActivity(cardId: string, activity: Activity | null): boolean {
    const entry = this.entries.get(cardId)
    if (entry?.state.kind !== 'running') return false
    entry.activity = activity
    this.refresh(entry)
    return true
  }

  /** The running card's setup state (#39 D5); null when none, or for a card that isn't running. */
  setupState(cardId: string): SetupState | null {
    return this.entries.get(cardId)?.setup ?? null
  }

  /**
   * Types the setup line into the running card's main pane again (a retry, #39 D6) and sets its
   * setup `running`. Returns false, changing nothing, for a card that isn't running or whose shell
   * hasn't started yet.
   */
  typeSetup(cardId: string, setup: string): boolean {
    const entry = this.entries.get(cardId)
    if (entry?.state.kind !== 'running' || !entry.sessionId) return false
    this.api.write(entry.sessionId, `${setupLine(setup)}\r`)
    this.setSetup(entry, 'running')
    return true
  }

  /**
   * `board setup . failed` (#39 D4): the running card's setup is `failed`; nothing is typed.
   * Returns false, changing nothing, for a card that isn't running.
   */
  setupFailed(cardId: string): boolean {
    const entry = this.entries.get(cardId)
    if (entry?.state.kind !== 'running') return false
    this.setSetup(entry, 'failed')
    return true
  }

  /**
   * After the setup succeeded or was skipped (#39 D4, D6): clears the running card's setup state
   * and types its start line into the main pane as `start` does, running `onFirstStart` for a
   * first start (#5 D5, #21 D3). `card` is the card as it is now, its pending setup cleared.
   * Returns false, changing nothing, for a card that isn't running or whose shell hasn't started.
   */
  continueAfterSetup(card: StartingCard, onFirstStart?: (kind: FirstStart) => void): boolean {
    const entry = this.entries.get(card.id)
    if (entry?.state.kind !== 'running' || !entry.sessionId) return false
    this.setSetup(entry, null)
    const line = startLine(card)
    if (line === null) return true
    this.api.write(entry.sessionId, `${line}\r`)
    const first = firstStart(card)
    if (first !== null) onFirstStart?.(first)
    return true
  }

  /** Called with a card's id and new setup state each time any card's setup state changes (#39 D5). */
  onSetup(listener: (cardId: string, setup: SetupState | null) => void): void {
    this.setupListeners.push(listener)
  }

  /**
   * Called with a card's id each time a start of it ends: its shell stops for any reason (it
   * exits, or is Closed) and the card is Stopped, or its shell couldn't start (#5 D8); not when
   * the card is disposed. The card's extra panes end with it (#11 D1, D6).
   */
  onEnded(listener: (cardId: string) => void): void {
    this.endedListeners.push(listener)
  }

  /**
   * Called with a card's id and new activity each time any card's activity changes, cleared
   * (null) included: for notifications, which watch every card.
   */
  onActivity(listener: (cardId: string, activity: Activity | null) => void): void {
    this.activityListeners.push(listener)
  }

  /**
   * Called when the card's status changes, from its first start on even when subscribed before
   * it. Returns an unsubscribe function.
   */
  subscribe(cardId: string, listener: () => void): () => void {
    const entry = this.entries.get(cardId)
    if (!entry) {
      const early = this.early.get(cardId) ?? new Set()
      early.add(listener)
      this.early.set(cardId, early)
      return () => {
        early.delete(listener)
        this.entries.get(cardId)?.listeners.delete(listener)
      }
    }
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

  /** `parsed` acknowledges the chunk once the screen has it (#16 D4). */
  private output(entry: Entry<S>, data: string, parsed: () => void): void {
    entry.watch?.(data)
    if (!entry.screen) return parsed()
    entry.screen.write(data, () => {
      parsed()
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
    // A start, a stop and a failed start all clear the agent status and activity (#9 D8, #31 D12).
    entry.agentStatus = ''
    entry.activity = null
    this.setSetup(entry, null)
    if (state.kind === 'failed') entry.screen?.setReadOnly()
    this.refresh(entry)
  }

  private setSetup(entry: Entry<S>, setup: SetupState | null): void {
    if (entry.setup === setup) return
    entry.setup = setup
    entry.listeners.forEach((l) => l())
    for (const listener of this.setupListeners) listener(entry.cardId, setup)
  }

  /** Recomputes the status from the screen and notifies when it changed. */
  private refresh(entry: Entry<S>): void {
    const { lines, cursorRow } = entry.screen?.screen() ?? { lines: [], cursorRow: 0 }
    const next = cardStatus(
      entry.state,
      lastOutputLine(lines, cursorRow),
      entry.agentStatus,
      entry.activity
    )
    const prev = entry.status
    if (
      next.label === prev.label &&
      next.agentStatus === prev.agentStatus &&
      next.lastLine === prev.lastLine &&
      next.activity === prev.activity
    )
      return
    entry.status = next
    entry.listeners.forEach((l) => l())
    if (next.activity !== prev.activity) {
      for (const listener of this.activityListeners) listener(entry.cardId, next.activity ?? null)
    }
  }
}
