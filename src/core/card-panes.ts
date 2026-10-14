/**
 * Each card's extra panes and their layout (#11 D1–D3, D5): a plain login shell per extra pane,
 * started in the card's directory with the card's id and no startup line, on its own screen.
 * The main pane is the card's own terminal in `CardSessions`; this registry only knows it as
 * the leaf `MAIN_PANE`. Sessions go through the router shared with `CardSessions`, so early
 * output is never lost to a second listener. Plain TS, like `CardSessions`.
 */
import type { TerminalApi } from '../shared/api'
import type { CardRef, CardScreen } from './card-sessions'
import type { SessionRouter } from './session-router'
import {
  focusPane,
  initialLayout,
  removePane,
  splitFocused,
  type PaneLayout,
  type SplitDirection
} from './split-tree'

interface Pane<S> {
  screen: S
  /** Null until the spawn reply arrives, and after the shell couldn't start. */
  sessionId: string | null
  /** Set once the pane is closed or its shell exited: a late spawn reply is killed. */
  removed: boolean
}

/** A card with no extra panes: the same object every time, for `useSyncExternalStore`. */
const SINGLE = initialLayout()

export class CardPanes<S extends CardScreen> {
  private readonly layouts = new Map<string, PaneLayout>()
  private readonly panes = new Map<string, Map<string, Pane<S>>>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private next = 0

  constructor(
    private readonly api: TerminalApi,
    private readonly router: SessionRouter,
    private readonly createScreen: (cardId: string) => S
  ) {}

  /** The card's panes and which is focused; just the main pane for a card with no extras. */
  layout(cardId: string): PaneLayout {
    return this.layouts.get(cardId) ?? SINGLE
  }

  /** Extra pane `paneId`'s screen; undefined for the main pane or an unknown one. */
  screen(cardId: string, paneId: string): S | undefined {
    return this.panes.get(cardId)?.get(paneId)?.screen
  }

  /**
   * Splits the card's focused pane (D2): a new extra pane gets the focus and starts its shell at
   * once. Returns its id, or undefined at 4 panes.
   */
  split(card: CardRef, direction: SplitDirection): string | undefined {
    const id = `pane-${++this.next}`
    const before = this.layout(card.id)
    const after = splitFocused(before, direction, id)
    if (after === before) return undefined
    const screen = this.createScreen(card.id)
    const pane: Pane<S> = { screen, sessionId: null, removed: false }
    let cardPanes = this.panes.get(card.id)
    if (!cardPanes) this.panes.set(card.id, (cardPanes = new Map()))
    cardPanes.set(id, pane)
    screen.onInput((data) => {
      if (pane.sessionId) this.api.write(pane.sessionId, data)
    })
    screen.onResize(({ cols, rows }) => {
      if (pane.sessionId) this.api.resize(pane.sessionId, cols, rows)
    })
    const { cols, rows } = screen
    this.router.spawn(cols, rows, card.directory, card.id, (result) => {
      if (pane.removed) return result.ok ? this.api.kill(result.id) : undefined
      if (!result.ok) {
        // Read-only, and it stays until closed (D5, #5 D8).
        screen.write(`Couldn't start: ${result.reason}\r\n`)
        return screen.setReadOnly()
      }
      pane.sessionId = result.id
      const early = this.router.adopt(result.id, {
        output: (data) => screen.write(data),
        exited: () => this.remove(card.id, id)
      })
      // The view may have fitted the screen while the shell was starting.
      if (screen.cols !== cols || screen.rows !== rows) {
        this.api.resize(result.id, screen.cols, screen.rows)
      }
      early.data.forEach((data) => screen.write(data))
      // A shell that exits by itself takes its pane with it (D5).
      if (early.exit) this.remove(card.id, id)
    })
    this.setLayout(card.id, after)
    return id
  }

  /** Focuses one of the card's panes (D3). */
  focus(cardId: string, paneId: string): void {
    this.setLayout(cardId, focusPane(this.layout(cardId), paneId))
  }

  /**
   * Closes extra pane `paneId` (D5): kills its shell, at once or as soon as its session arrives,
   * and removes the pane. The main pane has no close.
   */
  close(cardId: string, paneId: string): void {
    const pane = this.panes.get(cardId)?.get(paneId)
    if (!pane) return
    if (pane.sessionId) {
      this.router.release(pane.sessionId)
      this.api.kill(pane.sessionId)
    }
    this.remove(cardId, paneId)
  }

  /** Called when the card's layout changes. Returns an unsubscribe function. */
  subscribe(cardId: string, listener: () => void): () => void {
    let set = this.listeners.get(cardId)
    if (!set) this.listeners.set(cardId, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }

  private setLayout(cardId: string, layout: PaneLayout): void {
    if (layout === this.layout(cardId)) return
    this.layouts.set(cardId, layout)
    this.listeners.get(cardId)?.forEach((l) => l())
  }

  private remove(cardId: string, paneId: string): void {
    const pane = this.panes.get(cardId)?.get(paneId)
    if (!pane) return
    pane.removed = true
    this.panes.get(cardId)?.delete(paneId)
    pane.screen.dispose()
    this.setLayout(cardId, removePane(this.layout(cardId), paneId))
  }
}
