/**
 * One terminal per card for the card's whole life (#4 D3, D10, D11): its screen, its shell
 * session in main, and its status (D9). Plain TS: the renderer injects the terminal bridge and a
 * factory for screens (xterm in the app, fakes in tests), so views can come and go while the
 * screen keeps receiving output.
 */
import type { TerminalApi, TerminalExit } from '../shared/api'
import { cardStatus, lastOutputLine, type CardRunState, type CardStatus } from './card-status'

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
  /** Stops taking input: the process is gone (D11). */
  setReadOnly(): void
  dispose(): void
}

export interface CardRef {
  id: string
  directory: string
}

/** The board shows a card's status at most about 4 times a second (D9). */
export const STATUS_INTERVAL_MS = 250

interface Entry<S> {
  screen: S
  sessionId: string | null
  state: CardRunState
  status: CardStatus
  listeners: Set<() => void>
  /** Pending throttle timer; `dirty` means output landed since the last status update. */
  timer: ReturnType<typeof setTimeout> | null
  dirty: boolean
  disposed: boolean
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

  /** Creates the card's screen and starts its shell in the card's directory. */
  start(card: CardRef): void {
    const screen = this.createScreen(card.id)
    const state: CardRunState = { kind: 'running' }
    const entry: Entry<S> = {
      screen,
      sessionId: null,
      state,
      status: cardStatus(state, ''),
      listeners: new Set(),
      timer: null,
      dirty: false,
      disposed: false
    }
    this.entries.set(card.id, entry)
    screen.onInput((data) => {
      if (entry.sessionId && entry.state.kind === 'running') this.api.write(entry.sessionId, data)
    })
    screen.onResize(({ cols, rows }) => {
      if (entry.sessionId) this.api.resize(entry.sessionId, cols, rows)
    })
    const { cols, rows } = screen
    const failed = (reason: string): void => {
      if (entry.disposed) return
      screen.write(`Couldn't start: ${reason}\r\n`)
      this.setState(entry, { kind: 'failed', reason })
    }
    this.starting++
    void this.api
      .spawn(cols, rows, card.directory)
      .then(
        (result) => {
          if (!result.ok) return failed(result.reason)
          if (entry.disposed) return this.api.kill(result.id)
          entry.sessionId = result.id
          this.bySession.set(result.id, entry)
          // The view may have fitted the screen while the shell was starting.
          if (screen.cols !== cols || screen.rows !== rows) {
            this.api.resize(result.id, screen.cols, screen.rows)
          }
          const early = this.early.get(result.id)
          early?.data.forEach((data) => this.output(entry, data))
          if (early?.exit) this.exited(entry, early.exit)
        },
        (error: unknown) => failed(error instanceof Error ? error.message : String(error))
      )
      .finally(() => {
        if (--this.starting === 0) this.early.clear()
      })
  }

  /** Running, exited or couldn't start; undefined for an unknown card. */
  runState(cardId: string): CardRunState | undefined {
    return this.entries.get(cardId)?.state
  }

  screen(cardId: string): S | undefined {
    return this.entries.get(cardId)?.screen
  }

  /** The card's status; the same object until it changes, for `useSyncExternalStore`. */
  status(cardId: string): CardStatus | undefined {
    return this.entries.get(cardId)?.status
  }

  /** Called when the card's status changes. Returns an unsubscribe function. */
  subscribe(cardId: string, listener: () => void): () => void {
    const entry = this.entries.get(cardId)
    if (!entry) return () => {}
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
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
    entry.screen.dispose()
  }

  private earlyFor(id: string): { data: string[]; exit?: TerminalExit } {
    let early = this.early.get(id)
    if (!early) this.early.set(id, (early = { data: [] }))
    return early
  }

  private output(entry: Entry<S>, data: string): void {
    entry.screen.write(data, () => {
      if (!entry.disposed) this.outputLanded(entry)
    })
  }

  private exited(entry: Entry<S>, { id, exitCode, signal }: TerminalExit): void {
    this.bySession.delete(id)
    entry.sessionId = null
    this.setState(entry, { kind: 'exited', exitCode, signal })
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
    if (state.kind !== 'running') entry.screen.setReadOnly()
    this.refresh(entry)
  }

  /** Recomputes the status from the screen and notifies when it changed. */
  private refresh(entry: Entry<S>): void {
    const { lines, cursorRow } = entry.screen.screen()
    const next = cardStatus(entry.state, lastOutputLine(lines, cursorRow))
    if (next.label === entry.status.label && next.lastLine === entry.status.lastLine) return
    entry.status = next
    entry.listeners.forEach((l) => l())
  }
}
