import { stripEscapes } from './card-status'

/**
 * Dev server URLs in a terminal's output (#49 D1): an http or https URL on `localhost`,
 * `127.0.0.1`, `0.0.0.0` or `[::1]` with an explicit port from 1 to 65535. Plain TS, no DOM.
 */

/** A dev server URL found in output: its port, and the URL to open for it (D8). */
export interface DevServerUrl {
  port: number
  url: string
}

/** The most characters of an unfinished line carried to the next chunk (D1). */
export const MAX_CARRY_CHARS = 4096

const URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{1,5})(?=$|[/?#\s.,;:)\]'">])([/?#][^\s"'<>`]*)?/gi

const TRAILING = /[.,;:)\]'">]+$/

/**
 * The URL a match opens: canonical, with `0.0.0.0` replaced by `localhost` (D8), and its trailing
 * punctuation dropped (D1).
 */
function openUrl(text: string): string {
  const trimmed = text.replace(TRAILING, '')
  const url = new URL(trimmed)
  if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
  return url.href
}

/** The dev server URLs on one line of plain text, in order. */
export function devServerUrls(line: string): DevServerUrl[] {
  const found: DevServerUrl[] = []
  for (const match of line.matchAll(URL_PATTERN)) {
    const port = Number(match[1])
    if (port < 1 || port > 65535) continue
    try {
      found.push({ port, url: openUrl(match[0]) })
    } catch {
      // Not a URL after all; nothing to open.
    }
  }
  return found
}

/**
 * A scanner for one session's output: each call takes the next chunk and returns the URLs on the
 * lines it finished, read after escape sequences and control characters are removed. The
 * unfinished last line is carried to the next chunk (its last `MAX_CARRY_CHARS` only), so a URL
 * split across chunks, even inside an escape sequence, is found once.
 */
export function urlScanner(): (chunk: string) => DevServerUrl[] {
  let carry = ''
  return (chunk) => {
    const lines = (carry + chunk).split('\n')
    const last = lines.pop() ?? ''
    carry = last.length > MAX_CARRY_CHARS ? last.slice(-MAX_CARRY_CHARS) : last
    return lines.flatMap((line) => devServerUrls(stripEscapes(line)))
  }
}
