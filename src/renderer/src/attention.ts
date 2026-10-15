import { ACTIVITY_LABELS, type Activity } from '../../core/activity'
import { playTone } from './bell'
import { cardTerminals } from './card-terminals'
import { settingsStore } from './settings'
import { workspaceStore } from './store'

/**
 * Telling the user when an agent needs them: a notification (with a tone, when on) as a card's
 * activity becomes Waiting for you or Needs your answer, unless that card is open in the focused
 * window; the Dock badge counts the cards waiting. Clicking a notification opens its card.
 */

const NEEDS_YOU: ReadonlySet<Activity> = new Set(['waiting', 'question'])

/** The cards whose agent waits for the user now, for the badge. */
const waiting = new Set<string>()
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

function updateBadge(): void {
  window.drovr.app.setBadge(settingsStore.get().notifications ? waiting.size : 0)
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
    const was = waiting.has(cardId)
    if (activity && NEEDS_YOU.has(activity)) waiting.add(cardId)
    else waiting.delete(cardId)
    if (waiting.has(cardId) !== was) updateBadge()
    if (activity && NEEDS_YOU.has(activity)) notify(cardId, activity)
  })
  // A deleted card no longer waits.
  workspaceStore.subscribe(() => {
    const ids = new Set(
      workspaceStore.getState().workspaces.flatMap((w) => w.cards.map((c) => c.id))
    )
    let changed = false
    for (const id of waiting) {
      if (!ids.has(id)) changed = waiting.delete(id) || changed
    }
    if (changed) updateBadge()
  })
  // Turning notifications off clears the badge; on brings it back.
  let notifications = settingsStore.get().notifications
  settingsStore.subscribe(() => {
    if (settingsStore.get().notifications === notifications) return
    notifications = settingsStore.get().notifications
    updateBadge()
  })
}
