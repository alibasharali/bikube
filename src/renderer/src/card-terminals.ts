import { useCallback, useSyncExternalStore } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { runningCount } from '../../core/card-deletes'
import { isBackShortcut, isSettingsShortcut } from '../../core/card-shortcuts'
import { CardPanes } from '../../core/card-panes'
import { CardSessions, type CardScreen } from '../../core/card-sessions'
import { SessionRouter } from '../../core/session-router'
import type { PaneLayout } from '../../core/split-tree'
import {
  knownRunState,
  knownStatus,
  type CardRunState,
  type CardStatus
} from '../../core/card-status'
import { clipboardShortcut, copySelection, pasteFromClipboard } from '../../core/clipboard'
import { terminalAppearance, type TerminalAppearance } from '../../core/terminal-appearance'
import { isSoftwareRenderer } from '../../core/webgl-support'
import { settingsStore } from './settings'
import '@xterm/xterm/css/xterm.css'

let webglWorthIt: boolean | undefined

/** WebGL is worth using only when a real GPU backs it; software GL loses to the DOM renderer. */
function hardwareWebgl(): boolean {
  if (webglWorthIt !== undefined) return webglWorthIt
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return (webglWorthIt = false)
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return (webglWorthIt = !isSoftwareRenderer(renderer))
  } catch {
    return (webglWorthIt = false)
  }
}

/** Every screen not yet disposed, so a settings or OS appearance change reaches them all. */
const liveScreens = new Set<XtermScreen>()
let darkQuery: MediaQueryList | undefined
let following = false

/** The OS appearance as the page sees it: main's native theme, which follows the OS under System. */
function osPrefersDark(): boolean {
  darkQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
  return darkQuery.matches
}

/** The terminal look for the current settings and OS appearance (#10 D3, D4). */
function currentAppearance(): TerminalAppearance {
  return terminalAppearance(settingsStore.get(), osPrefersDark())
}

/**
 * Applies the current look to every screen whenever the settings or the OS appearance change,
 * running or not (D3); set up once, with the first screen.
 */
function followAppearance(): void {
  if (following) return
  following = true
  const apply = (): void => {
    const appearance = currentAppearance()
    for (const screen of liveScreens) screen.applyAppearance(appearance)
  }
  settingsStore.subscribe(apply)
  osPrefersDark()
  darkQuery?.addEventListener('change', apply)
}

/** The element the smoke tests read the buffer from. */
export type TerminalHost = HTMLDivElement & { __xterm?: XTerm }

/**
 * A card's xterm.js screen for one start (#5 D6, D7), discarded when the card is Stopped. It
 * parses output while no view shows it; the full-size view attaches its element and fits it. Only an attached screen gets
 * a WebGL context, since Chromium caps them at about 16.
 */
export class XtermScreen implements CardScreen {
  readonly term: XTerm
  private palette: TerminalAppearance['theme']
  private readonly host: TerminalHost = document.createElement('div')
  private readonly fit = new FitAddon()
  private opened = false
  private webgl: WebglAddon | undefined

  constructor() {
    const { fontFamily, fontSize, theme } = currentAppearance()
    this.palette = theme
    this.term = new XTerm({ fontFamily, fontSize, theme: { ...theme } })
    followAppearance()
    liveScreens.add(this)
    this.host.className = 'terminal'
    this.host.dataset.testid = 'terminal'
    this.host.__xterm = this.term
    this.term.loadAddon(this.fit)
    const clipboard = window.drovr.clipboard
    this.term.attachCustomKeyEventHandler((event) => {
      // Back to the board is handled by the view; the shell never sees it (D8).
      if (isBackShortcut(event, window.drovr.platform)) return false
      // So is opening Settings, handled by the app (#10 D5).
      if (isSettingsShortcut(event, window.drovr.platform)) return false
      const action = clipboardShortcut(event, window.drovr.platform)
      if (!action) return true
      // Stop the native paste event too, or xterm would paste twice.
      event.preventDefault()
      if (action === 'copy') void copySelection(this.term, clipboard)
      else void pasteFromClipboard(this.term, clipboard)
      return false
    })
  }

  get cols(): number {
    return this.term.cols
  }

  get rows(): number {
    return this.term.rows
  }

  write(data: string, done?: () => void): void {
    this.term.write(data, done)
  }

  onInput(listener: (data: string) => void): void {
    this.term.onData(listener)
  }

  onResize(listener: (size: { cols: number; rows: number }) => void): void {
    this.term.onResize(listener)
  }

  screen(): { lines: string[]; cursorRow: number } {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let row = 0; row < this.term.rows; row++) {
      lines.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '')
    }
    return { lines, cursorRow: buffer.cursorY }
  }

  setReadOnly(): void {
    this.term.options.disableStdin = true
  }

  /** Shows the screen in `container`, fitted and kept fitted; returns the detach function. */
  attach(container: HTMLElement): () => void {
    container.appendChild(this.host)
    if (!this.opened) {
      this.term.open(this.host)
      this.opened = true
    }
    this.fitNow()
    this.loadWebgl()
    const observer = new ResizeObserver(() => this.fitNow())
    observer.observe(container)
    this.term.refresh(0, this.term.rows - 1)
    return () => {
      observer.disconnect()
      this.dropWebgl()
      this.host.remove()
    }
  }

  focus(): void {
    this.term.focus()
  }

  /**
   * Takes on a new look without touching the process or the scrollback (D3, D4). An attached
   * screen refits, so new columns and rows reach its PTY as a resize; a detached one refits when
   * next attached.
   */
  applyAppearance({ fontFamily, fontSize, theme }: TerminalAppearance): void {
    const options = this.term.options
    if (this.palette !== theme) {
      this.palette = theme
      options.theme = { ...theme }
    }
    if (options.fontFamily === fontFamily && options.fontSize === fontSize) return
    options.fontFamily = fontFamily
    options.fontSize = fontSize
    this.fitNow()
  }

  dispose(): void {
    liveScreens.delete(this)
    this.dropWebgl()
    this.host.remove()
    this.term.dispose()
  }

  private fitNow(): void {
    if (this.host.isConnected && this.host.clientWidth > 0) this.fit.fit()
  }

  // WebGL where a real GPU backs it; xterm's DOM renderer stays in place otherwise.
  private loadWebgl(): void {
    if (this.webgl || !hardwareWebgl()) return
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => this.dropWebgl())
      this.term.loadAddon(webgl)
      this.webgl = webgl
    } catch {
      this.webgl = undefined
    }
  }

  private dropWebgl(): void {
    this.webgl?.dispose()
    this.webgl = undefined
  }
}

let router: SessionRouter | undefined
let registry: CardSessions<XtermScreen> | undefined
let paneRegistry: CardPanes<XtermScreen> | undefined

/** The one router of terminal events, shared by cards' own terminals and their extra panes. */
function sessionRouter(): SessionRouter {
  router ??= new SessionRouter(window.drovr.terminal)
  return router
}

/** The app-wide card terminals: one per card, with a fresh screen each start (#5 D7). */
export function cardTerminals(): CardSessions<XtermScreen> {
  registry ??= new CardSessions(window.drovr.terminal, () => new XtermScreen(), sessionRouter())
  return registry
}

/** The app-wide extra panes of cards (#11 D1), with their layouts. */
export function cardPanes(): CardPanes<XtermScreen> {
  paneRegistry ??= new CardPanes(window.drovr.terminal, sessionRouter(), () => new XtermScreen())
  return paneRegistry
}

/** The card's panes and which is focused (#11 D2, D3), re-rendering when they change. */
export function usePaneLayout(cardId: string): PaneLayout {
  return useSyncExternalStore(
    (listener) => cardPanes().subscribe(cardId, listener),
    () => cardPanes().layout(cardId)
  )
}

/**
 * The card's status (D9), re-rendering at most about 4 times a second while it prints; `Stopped`
 * for a card not started in this run, e.g. restored after a restart (#8 D9).
 */
export function useCardStatus(cardId: string): CardStatus {
  return useSyncExternalStore(
    (listener) => cardTerminals().subscribe(cardId, listener),
    () => knownStatus(cardTerminals().status(cardId))
  )
}

/** The card's process state: running, Stopped or couldn't start (#5 D6); see `useCardStatus`. */
export function useCardRunState(cardId: string): CardRunState {
  return useSyncExternalStore(
    (listener) => cardTerminals().subscribe(cardId, listener),
    () => knownRunState(cardTerminals().runState(cardId))
  )
}

/** How many of `cards` have a running process, kept current as their processes exit (D15). */
export function useRunningCount(cards: readonly { id: string }[]): number {
  const ids = cards.map((c) => c.id).join('\n')
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = ids
        .split('\n')
        .filter(Boolean)
        .map((id) => cardTerminals().subscribe(id, listener))
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
    [ids]
  )
  return useSyncExternalStore(subscribe, () =>
    runningCount(cards, (id) => cardTerminals().runState(id))
  )
}
