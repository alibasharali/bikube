import { useSyncExternalStore } from 'react'
import { ACTIVITY_LABELS, type Activity } from '../../core/activity'
import { longCommandNotice } from '../../core/long-commands'
import type { ShellCommand } from '../../core/shell-marks'
import { isWaiting, withActivity, withoutDeleted } from '../../core/waiting'
import { findShellCard } from '../../core/workspace-shells'
import { playTone } from './bell'
import { startCard } from './card-actions'
import { cardPanes, cardTerminals, onScreenCreated } from './card-terminals'
import { focusCardWindow } from './card-windows'
import { settingsStore } from './settings'
import { workspaceStore } from './store'
import { anyWindowFocused, focusedCardWindow } from './window-focus'

/**
 * Telling the user when an agent needs them: a notification (with a tone, when on) as a card's
 * activity becomes Waiting for you or Needs your answer, unless the user is looking at that card
 * (open in the focused main window, or its own window focused, #53 D10); the Dock badge counts the
 * cards waiting. Clicking a notification opens its card, or brings its own window forward.
 * A long command that ends out of sight gets one too (#45 D7), changing nothing else here.
 * The waiting cards and shells, oldest first (#41 D2), are a queue the sidebar follows.
 */

/** The cards and shells whose agent waits for the user now, oldest first (#41 D1, D2). */
let waiting: readonly string[] = []
const waitingListeners = new Set<() => void>()
/** The card open at full size in the main window, looked at while that window has focus. */
let lookingAt: string | null = null
let openRequest: ((workspaceId: string, cardId: string) => void) | null = null
let started = false

/** The app tells which card is open, so its own notifications are skipped while it's in view. */
export function setLookingAt(cardId: string | null): void {
  lookingAt = cardId
}

/** The app opens a card when its notification is clicked. Returns an unsubscribe function. */
export function onOpenRequest(handler: (workspaceId: string, cardId: string) => void): () => void {
  openRequest = handler
  return () => {
    if (openRequest === handler) openRequest = null
  }
}

/** The waiting cards' and shells' ids, oldest first (#41 D2). */
export function waitingQueue(): readonly string[] {
  return waiting
}

/** Calls `listener` each time the waiting queue changes. Returns an unsubscribe function. */
export function subscribeWaiting(listener: () => void): () => void {
  waitingListeners.add(listener)
  return () => waitingListeners.delete(listener)
}

/** The waiting queue, re-rendering as it changes (#41 D6). */
export function useWaitingQueue(): readonly string[] {
  return useSyncExternalStore(subscribeWaiting, waitingQueue)
}

function setWaiting(next: readonly string[]): void {
  if (next === waiting) return
  waiting = next
  updateBadge()
  for (const listener of waitingListeners) listener()
}

function updateBadge(): void {
  window.drovr.app.setBadge(settingsStore.get().notifications ? waiting.length : 0)
}

function cardOf(cardId: string): { workspaceId: string; workspace: string; title: string } | null {
  for (const workspace of workspaceStore.getState().workspaces) {
    const card = workspace.cards.find((c) => c.id === cardId)
    if (card) return { workspaceId: workspace.id, workspace: workspace.name, title: card.title }
  }
  return null
}

/**
 * The card (or shell) the user is looking at (#53 D10): the one whose own window is focused, else
 * the one open at full size in the main window while that is focused; null for none.
 */
function lookedAt(): string | null {
  return focusedCardWindow() ?? (document.hasFocus() ? lookingAt : null)
}

function notify(cardId: string, activity: Activity): void {
  const settings = settingsStore.get()
  if (!settings.notifications) return
  if (lookedAt() === cardId) return
  const card = cardOf(cardId)
  if (!card) return
  try {
    const notification = new Notification(card.title, {
      body: `${ACTIVITY_LABELS[activity]} · ${card.workspace}`,
      silent: true,
      tag: cardId
    })
    notification.onclick = () => {
      // In its own window: that window comes forward, the main window unchanged (#53 D7).
      if (focusCardWindow(cardId)) return
      window.drovr.app.focus()
      openRequest?.(card.workspaceId, cardId)
    }
  } catch {
    // Notifications unavailable: the badge and the card's pill still show it.
  }
  if (settings.notificationSound) playTone(660, 0.18)
  window.drovr.app.requestAttention()
}

/** Card or shell `id`'s title and workspace, the Default shell (never stored) included. */
function terminalOf(id: string): { workspaceId: string; workspace: string; title: string } | null {
  for (const workspace of workspaceStore.getState().workspaces) {
    const card = workspace.cards.find((c) => c.id === id) ?? findShellCard(workspace, id)
    if (card) return { workspaceId: workspace.id, workspace: workspace.name, title: card.title }
  }
  return null
}

/**
 * A command ended in pane `paneId` of card or shell `cardId` (#45 D7): tells of it when it ran
 * long and the user isn't looking at that pane. No activity, waiting queue or badge changes.
 */
function notifyLongCommand(cardId: string, paneId: string, command: ShellCommand<unknown>): void {
  const settings = settingsStore.get()
  if (!settings.notifications) return
  const terminal = terminalOf(cardId)
  if (!terminal) return
  // A card window's focus counts as its card's (#53 D10).
  const viewing = {
    windowFocused: anyWindowFocused(),
    openId: focusedCardWindow() ?? lookingAt,
    focusedPane: cardPanes().layout(cardId).focused
  }
  const at = { cardId, paneId }
  const notice = longCommandNotice(
    command,
    at,
    viewing,
    terminal.workspace,
    window.drovr.longCommandMs
  )
  if (!notice) return
  try {
    const notification = new Notification(terminal.title, { body: notice.body, silent: true })
    notification.onclick = () => {
      // In its own window: that window comes forward with the pane focused (#53 D7).
      if (focusCardWindow(cardId)) {
        cardPanes().focus(cardId, paneId)
        return
      }
      window.drovr.app.focus()
      // As a click on it would: started when stopped, in its workspace; then the pane, if still there.
      startCard(terminal.workspaceId, cardId)
      openRequest?.(terminal.workspaceId, cardId)
      cardPanes().focus(cardId, paneId)
    }
  } catch {
    // Notifications unavailable.
  }
  if (settings.notificationSound) playTone(660, 0.18)
  window.drovr.app.requestAttention()
}

/** Watches every card's activity; called once, before the first render. */
export function startAttention(): void {
  if (started) return
  started = true
  cardTerminals().onActivity((cardId, activity) => {
    setWaiting(withActivity(waiting, cardId, activity))
    if (activity && isWaiting(activity)) notify(cardId, activity)
  })
  onScreenCreated((screen, cardId, paneId) =>
    screen.marks.onCommandEnded((command) => notifyLongCommand(cardId, paneId, command))
  )
  // A deleted card or shell no longer waits; a workspace's Default shell isn't stored, but stays.
  workspaceStore.subscribe(() => {
    setWaiting(withoutDeleted(waiting, workspaceStore.getState().workspaces))
  })
  // Turning notifications off clears the badge; on brings it back.
  let notifications = settingsStore.get().notifications
  settingsStore.subscribe(() => {
    if (settingsStore.get().notifications === notifications) return
    notifications = settingsStore.get().notifications
    updateBadge()
  })
}
