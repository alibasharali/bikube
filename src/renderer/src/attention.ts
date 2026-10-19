import { useSyncExternalStore } from 'react'
import { ACTIVITY_LABELS, type Activity } from '../../core/activity'
import { isWaiting, withActivity, withoutDeleted } from '../../core/waiting'
import { playTone } from './bell'
import { cardTerminals } from './card-terminals'
import { settingsStore } from './settings'
import { workspaceStore } from './store'

/**
 * Telling the user when an agent needs them: a notification (with a tone, when on) as a card's
 * activity becomes Waiting for you or Needs your answer, unless that card is open in the focused
 * window; the Dock badge counts the cards waiting. Clicking a notification opens its card.
 * The waiting cards and shells, oldest first (#41 D2), are a queue the sidebar follows.
 */

/** The cards and shells whose agent waits for the user now, oldest first (#41 D1, D2). */
let waiting: readonly string[] = []
const waitingListeners = new Set<() => void>()
/** The card open at full size, which the user is looking at while the window has focus. */
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

function notify(cardId: string, activity: Activity): void {
  const settings = settingsStore.get()
  if (!settings.notifications) return
  if (lookingAt === cardId && document.hasFocus()) return
  const card = cardOf(cardId)
  if (!card) return
  try {
    const notification = new Notification(card.title, {
      body: `${ACTIVITY_LABELS[activity]} · ${card.workspace}`,
      silent: true,
      tag: cardId
    })
    notification.onclick = () => {
      window.drovr.app.focus()
      openRequest?.(card.workspaceId, cardId)
    }
  } catch {
    // Notifications unavailable: the badge and the card's pill still show it.
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
