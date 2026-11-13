import { SEND_ENTER_DELAY_MS } from '../../core/board-send'
import { SendMarks, waitForCard, type WaitResult } from '../../core/board-wait'
import { cardTerminals } from './card-terminals'

/**
 * `board send` and `board wait` on a card (#81 D19, D20), through the card's session in the
 * app-wide card terminals.
 */

/** Each card's `board activity` sets and last `board send`, for the run (D20). */
const sendMarks = new SendMarks()

/** `board activity` set the card's activity (any value, the same one again too). */
export function boardActivitySet(cardId: string): void {
  sendMarks.activitySet(cardId)
}

/** Forgets a deleted card's send marks. */
export function forgetSendMarks(cardId: string): void {
  sendMarks.forget(cardId)
}

/**
 * Types `text` (already cleaned) into the running card's main pane as one paste, then Enter
 * 50 ms later; resolves once the Enter is typed. A start that ended meanwhile gets nothing more:
 * its screen takes no input. Sets no activity and clears none, but makes the card's activity as
 * it is now stale for `board wait` (D20).
 */
export function sendToCard(cardId: string, text: string): Promise<void> {
  const screen = cardTerminals().screen(cardId)
  if (!screen) return Promise.resolve()
  sendMarks.sent(cardId)
  screen.paste(text)
  return new Promise((resolve) => {
    setTimeout(() => {
      if (cardTerminals().screen(cardId) === screen) screen.type('\r')
      resolve()
    }, SEND_ENTER_DELAY_MS)
  })
}

/**
 * Waits until the card is stopped, waiting for the user or asking, `seconds` at most, a `waiting`
 * or `question` set before its last send not counting; at once when `signal` aborts (the asking
 * `board wait` was interrupted).
 */
export function waitOnCard(
  cardId: string,
  seconds: number,
  signal?: AbortSignal
): Promise<WaitResult | 'timeout'> {
  const terminals = cardTerminals()
  return waitForCard(
    {
      read: () => ({
        running: terminals.runState(cardId)?.kind === 'running',
        activity: terminals.status(cardId)?.activity,
        stale: sendMarks.stale(cardId)
      }),
      // Its status changes with its activity and its run state (#31 D12, #5 D6); a set of the
      // same activity changes no status, so the marks tell of every set.
      subscribe: (listener) => {
        const offStatus = terminals.subscribe(cardId, listener)
        const offSets = sendMarks.subscribe(cardId, listener)
        return () => {
          offStatus()
          offSets()
        }
      },
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
    },
    seconds,
    signal
  )
}
