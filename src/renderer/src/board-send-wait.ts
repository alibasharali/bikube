import { SEND_ENTER_DELAY_MS } from '../../core/board-send'
import { waitForCard, type WaitResult } from '../../core/board-wait'
import { cardTerminals } from './card-terminals'

/**
 * The Orchestrator's `board send` and `board wait` on a card (#81 D19, D20), through the card's
 * session in the app-wide card terminals.
 */

/**
 * Types `text` (already cleaned) into the running card's main pane as one paste, then Enter
 * 50 ms later; resolves once the Enter is typed. A start that ended meanwhile gets nothing more:
 * its screen takes no input. Sets no activity and clears none.
 */
export function sendToCard(cardId: string, text: string): Promise<void> {
  const screen = cardTerminals().screen(cardId)
  if (!screen) return Promise.resolve()
  screen.paste(text)
  return new Promise((resolve) => {
    setTimeout(() => {
      if (cardTerminals().screen(cardId) === screen) screen.type('\r')
      resolve()
    }, SEND_ENTER_DELAY_MS)
  })
}

/** Waits until the card is stopped, waiting for the user or asking, `seconds` at most. */
export function waitOnCard(cardId: string, seconds: number): Promise<WaitResult | 'timeout'> {
  const terminals = cardTerminals()
  return waitForCard(
    {
      read: () => ({
        running: terminals.runState(cardId)?.kind === 'running',
        activity: terminals.status(cardId)?.activity
      }),
      // Its status changes with its activity and its run state (#31 D12, #5 D6).
      subscribe: (listener) => terminals.subscribe(cardId, listener),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
    },
    seconds
  )
}
