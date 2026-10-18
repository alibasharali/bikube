/** Which terminal links open in the browser, free of Electron and DOM imports. */

/** Longer than any URL worth opening; the rest is refused before parsing. */
const MAX_URL_LENGTH = 8_192

/** The URL to open for a clicked link, or null: only http and https leave the app. */
export function openableUrl(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > MAX_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

export interface ClickLike {
  metaKey: boolean
  ctrlKey: boolean
}

/** Cmd+click on macOS, Ctrl+click elsewhere, so a plain click can still select text. */
export function opensLink(event: ClickLike, platform: string): boolean {
  return platform === 'darwin' ? event.metaKey : event.ctrlKey
}
