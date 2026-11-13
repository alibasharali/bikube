/**
 * `board send`'s text (#81 D19): cleaned and checked by the CLI before it sends and again by the
 * renderer, then typed into the card's main pane as xterm's own paste would type it. Plain TS
 * with no Node imports.
 */
import { descriptionLength } from './card-description'

/** The most characters (code points) one send may type. */
export const MAX_SEND_LENGTH = 100_000

/** How long after the paste its Enter is typed, in ms. */
export const SEND_ENTER_DELAY_MS = 50

/** Every control character (C0, DEL, C1) but newline and tab. */
const CONTROL = /[^\P{Cc}\n\t]/gu

/** The text with every control character but newline and tab removed. */
export const cleanSendText = (text: string): string => text.replace(CONTROL, '')

/** The cleaned text to type, or the error when it is over 100,000 characters. */
export function checkSendText(
  text: string
): { ok: true; text: string } | { ok: false; error: string } {
  const cleaned = cleanSendText(text)
  if (descriptionLength(cleaned) > MAX_SEND_LENGTH) {
    return {
      ok: false,
      error: `board: the text is longer than ${MAX_SEND_LENGTH.toLocaleString('en-US')} characters`
    }
  }
  return { ok: true, text: cleaned }
}

/**
 * What xterm's paste sends for `text` (its `prepareTextForTerminal` and `bracketTextForPaste`):
 * each new line as CR, wrapped in bracketed-paste markers when the program turned that mode on.
 */
export function pasteData(text: string, bracketed: boolean): string {
  const data = text.replace(/\r?\n/g, '\r')
  return bracketed ? `\x1b[200~${data}\x1b[201~` : data
}
