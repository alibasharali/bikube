import { useCallback, useSyncExternalStore } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { runningCount } from '../../core/card-deletes'
import { isBackShortcut } from '../../core/card-shortcuts'
import { CardSessions, type CardScreen } from '../../core/card-sessions'
import type { CardRunState, CardStatus } from '../../core/card-status'
import { clipboardShortcut, copySelection, pasteFromClipboard } from '../../core/clipboard'
import { isSoftwareRenderer } from '../../core/webgl-support'
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

/** The element the smoke tests read the buffer from. */
export type TerminalHost = HTMLDivElement & { __xterm?: XTerm }

/**
 * A card's xterm.js screen. It exists from card creation on and parses output while no view
 * shows it; the full-size view attaches its element and fits it. Only an attached screen gets
 * a WebGL context, since Chromium caps them at about 16.
 */
export class XtermScreen implements CardScreen {
  readonly term = new XTerm({ fontFamily: 'Menlo, Consolas, monospace', fontSize: 13 })
  private readonly host: TerminalHost = document.createElement('div')
  private readonly fit = new FitAddon()
  private opened = false
  private webgl: WebglAddon | undefined

  constructor() {
    this.host.className = 'terminal'
    this.host.dataset.testid = 'terminal'
    this.host.__xterm = this.term
    this.term.loadAddon(this.fit)
    const clipboard = window.drovr.clipboard
    this.term.attachCustomKeyEventHandler((event) => {
      // Back to the board is handled by the view; the shell never sees it (D8).
      if (isBackShortcut(event, window.drovr.platform)) return false
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

  dispose(): void {
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

let registry: CardSessions<XtermScreen> | undefined

/** The app-wide card terminals: one per card for the card's life (#4 D10). */
export function cardTerminals(): CardSessions<XtermScreen> {
  registry ??= new CardSessions(window.drovr.terminal, () => new XtermScreen())
  return registry
}

/** The card's status (D9), re-rendering at most about 4 times a second while it prints. */
export function useCardStatus(cardId: string): CardStatus | undefined {
  return useSyncExternalStore(
    (listener) => cardTerminals().subscribe(cardId, listener),
    () => cardTerminals().status(cardId)
  )
}

/** The card's process state: running, Stopped or couldn't start (#5 D6). */
export function useCardRunState(cardId: string): CardRunState | undefined {
  return useSyncExternalStore(
    (listener) => cardTerminals().subscribe(cardId, listener),
    () => cardTerminals().runState(cardId)
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
