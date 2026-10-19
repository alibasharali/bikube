/**
 * A card's kept output (#46): the main pane's serialized screen saved when its shell stops and
 * written back above the next start's prompt. Plain TS with no DOM or Node imports: the renderer
 * runs the trimming rule (D3) and builds the separator (D5), main checks the size.
 */

/** The most characters of serialized output a save holds; main refuses anything longer (D3). */
export const MAX_KEPT_CHARS = 1_000_000

/** A card's save as main reads it back: the serialized screen and when it was saved (epoch ms). */
export interface KeptOutput {
  data: string
  savedAt: number
}

/**
 * The text to save (D3): `serialize(rows)` gives the screen with the newest `rows` scrollback
 * rows above it. Starts at the Scrollback setting and halves the rows until the text is at most
 * `MAX_KEPT_CHARS`; the screen alone (0 rows) always counts, cut to its last `MAX_KEPT_CHARS`
 * characters at a line break if even that is too long.
 */
export function keptOutput(serialize: (rows: number) => string, scrollback: number): string {
  let rows = Math.max(0, Math.floor(scrollback))
  for (;;) {
    const text = serialize(rows)
    if (text.length <= MAX_KEPT_CHARS) return text
    if (rows === 0) return cutAtLineBreak(text)
    rows = Math.floor(rows / 2)
  }
}

function cutAtLineBreak(text: string): string {
  const tail = text.slice(-MAX_KEPT_CHARS)
  const lineBreak = tail.indexOf('\n')
  return lineBreak === -1 ? tail : tail.slice(lineBreak + 1)
}

/**
 * What a start writes into its new screen before the shell spawns (D5): the save, attributes
 * reset, a fresh line, then a dim `── Previous output · <ended> ──` with the save's date and time
 * in `locale` (the user's by default), and CRLF.
 */
export function restoredText({ data, savedAt }: KeptOutput, locale?: string): string {
  const ended = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(savedAt))
  return `${data}\x1b[0m\r\n\x1b[2m── Previous output · ${ended} ──\x1b[0m\r\n`
}
