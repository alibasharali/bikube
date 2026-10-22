import { createElement, StrictMode, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { cardWindowName } from '../../core/card-window-name'
import { findShellCard } from '../../core/workspace-shells'
import { startCard } from './card-actions'
import CardWindow from './CardWindow'
import { workspaceStore } from './store'
import { loadSymbolsFont } from './symbols-font'
import { addCardWindow, removeCardWindow } from './window-focus'

/** A card (or shell) shown in its own window (#53 D1, D2). */
interface OpenWindow {
  workspaceId: string
  view: Window
  root: Root | null
}

/** The card windows by card id, runtime only (D9). */
const windows = new Map<string, OpenWindow>()
const listeners = new Set<() => void>()
let watchingStore = false

function changed(): void {
  key = [...windows.keys()].join('\n')
  for (const listener of listeners) listener()
}

/** Whether card (or shell) `cardId` is shown in its own window (D7). */
export function isInWindow(cardId: string): boolean {
  return windows.has(cardId)
}

/** The ids of the cards in their own windows, one per line: a snapshot that changes with them. */
let key = ''

/** The cards (and shells) in their own windows, as one string of ids, one per line. */
export function windowedKey(): string {
  return key
}

/** Calls `listener` whenever a card window opens or closes; returns the unsubscribe function. */
export function subscribeCardWindows(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether `cardId` is in its own window, re-rendering as that changes (D7). */
export function useInWindow(cardId: string): boolean {
  return useSyncExternalStore(subscribeCardWindows, () => isInWindow(cardId))
}

/**
 * Brings card `cardId`'s window forward, by main (D3, D7); returns whether it has one. Opening a
 * card that is in its own window does this and changes nothing in the main window.
 */
export function focusCardWindow(cardId: string): boolean {
  if (!windows.has(cardId)) return false
  window.bikube.cardWindow.focus(cardId)
  return true
}

/**
 * Closes card `cardId`'s window, if it has one (D8): its view goes, detaching its screens, so the
 * card is again only on its board; its processes keep running unless they stopped.
 */
export function closeCardWindow(cardId: string): void {
  const open = windows.get(cardId)
  if (!open) return
  windows.delete(cardId)
  removeCardWindow(cardId)
  changed()
  // After the current task's React work: this may run from the view's own effects (Back, a stop).
  queueMicrotask(() => {
    open.root?.unmount()
    if (!open.view.closed) open.view.close()
  })
}

let returnRequest: ((workspaceId: string, cardId: string) => void) | null = null

/** The app opens a card moved back from its own window. Returns an unsubscribe function. */
export function onReturnRequest(
  handler: (workspaceId: string, cardId: string) => void
): () => void {
  returnRequest = handler
  return () => {
    if (returnRequest === handler) returnRequest = null
  }
}

/**
 * Moves card (or shell) `cardId` from its own window back to the main window: the window closes,
 * the main window comes forward and opens the card at full size in its workspace. It keeps
 * running, its panes and output as they were.
 */
export function returnCardWindow(cardId: string): void {
  const open = windows.get(cardId)
  if (!open) return
  closeCardWindow(cardId)
  window.bikube.app.focus()
  returnRequest?.(open.workspaceId, cardId)
}

/**
 * Opens card (or shell) `cardId` of workspace `workspaceId` in its own window (D2, D6), or brings
 * it forward when it has one. A card that isn't running starts first, as opening it does (#5 D7).
 * The window is `about:blank`, opened by this page under main's open handler (D3), with the app's
 * stylesheets and the symbols font (D4) before the card view is drawn into it.
 */
export function openCardWindow(workspaceId: string, cardId: string): void {
  if (focusCardWindow(cardId)) return
  if (!cardExists(workspaceId, cardId)) return
  const view = window.open('about:blank', cardWindowName(cardId))
  if (!view) return
  const open: OpenWindow = { workspaceId, view, root: null }
  windows.set(cardId, open)
  // Its focus counts as the app's: notifications, long commands, refreshes (D10).
  addCardWindow(cardId, view)
  watchStore()
  changed()
  // The user closed the window (its close button, Close Window on macOS).
  view.addEventListener('pagehide', () => closeCardWindow(cardId))
  // A file or link dropped on it opens nothing (D4).
  for (const type of ['dragover', 'drop'] as const) {
    view.document.addEventListener(type, (event) => event.preventDefault())
  }
  void Promise.all([copyStylesheets(view), loadSymbolsFont(view)]).then(() => {
    if (windows.get(cardId) !== open) return
    startCard(workspaceId, cardId)
    const container = view.document.createElement('div')
    container.id = 'root'
    view.document.body.appendChild(container)
    open.root = createRoot(container)
    // Drawn at once, so a card just started is fitted before its shell spawns (#22 D1).
    flushSync(() =>
      open.root?.render(
        createElement(
          StrictMode,
          null,
          createElement(CardWindow, {
            view,
            workspaceId,
            cardId,
            onBack: () => closeCardWindow(cardId),
            onReturn: () => returnCardWindow(cardId)
          })
        )
      )
    )
  })
}

/** The main window's stylesheets in `view`'s head; resolves once they have loaded (D4). */
function copyStylesheets(view: Window): Promise<unknown> {
  const head = view.document.head
  const loads: Promise<void>[] = []
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (node instanceof HTMLLinkElement) {
      const link = view.document.createElement('link')
      link.rel = 'stylesheet'
      // Absolute: the window is `about:blank`.
      link.href = node.href
      loads.push(new Promise((resolve) => (link.onload = link.onerror = () => resolve())))
      head.appendChild(link)
    } else {
      const style = view.document.createElement('style')
      style.textContent = node.textContent
      head.appendChild(style)
    }
  }
  return Promise.all(loads)
}

/** Whether workspace `workspaceId` has card or shell `cardId`. */
function cardExists(workspaceId: string, cardId: string): boolean {
  const workspace = workspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  return (
    workspace !== undefined &&
    (workspace.cards.some((c) => c.id === cardId) || findShellCard(workspace, cardId) !== undefined)
  )
}

/** A card window closes when its card, or its workspace, is deleted (D8). */
function watchStore(): void {
  if (watchingStore) return
  watchingStore = true
  workspaceStore.subscribe(() => {
    for (const [cardId, open] of windows) {
      if (!cardExists(open.workspaceId, cardId)) closeCardWindow(cardId)
    }
  })
}
