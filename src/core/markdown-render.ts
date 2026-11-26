/**
 * The file editor's Markdown preview (#83 D10): markdown-it with CommonMark, tables,
 * strikethrough and linkify, raw HTML shown as text, task list items as disabled checkboxes,
 * headings with ids for `#anchor` links, and relative images named by their path inside the
 * folder for main to read (D6). What a clicked link does is `markdownLink`. Node-free: the
 * renderer runs it.
 */
import MarkdownIt from 'markdown-it'
import type { StateCore, Token } from 'markdown-it'
import { openableUrl } from './terminal-links'

/** A heading's id is this plus its slug, so no id names one of the page's own globals. */
const HEADING_ID_PREFIX = 'md-'

/** `.md` and `.markdown` open in Preview (D10). */
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/**
 * `target` resolved against `base`'s folder, both relative to the reference's folder: a
 * `/`-separated path inside it, or null for anything absolute, with a scheme, escaping it,
 * naming no file or not decodable.
 */
export function resolveRelative(base: string, target: string): string | null {
  if (target === '' || target.startsWith('/') || target.startsWith('\\')) return null
  // A scheme (`file:`, `C:`) is never a relative path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  const parts = base.split('/').slice(0, -1)
  for (const raw of target.split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return null
    }
    // A decoded separator would name another path than the one checked.
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\0')) return null
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(segment)
  }
  if (parts.length === 0 || target.endsWith('/')) return null
  return parts.join('/')
}

/** A heading's slug, as GitHub makes one: lower case, punctuation dropped, spaces as `-`. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** What a click on a preview link does (D10). */
export type MarkdownLink =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'anchor'; id: string }
  | { kind: 'none' }

/**
 * A link's `href` as the preview rendered it: `http`/`https` open outside, `#anchor` scrolls to
 * its heading's id, a relative path inside the folder opens that file (`base` the Markdown file's
 * path in its folder, null when it has none, as a listed file: then no relative link opens),
 * anything else does nothing.
 */
export function markdownLink(href: string, base: string | null): MarkdownLink {
  if (href.startsWith('#')) {
    let fragment: string
    try {
      fragment = decodeURIComponent(href.slice(1))
    } catch {
      return { kind: 'none' }
    }
    const id = slug(fragment)
    return id === '' ? { kind: 'none' } : { kind: 'anchor', id: HEADING_ID_PREFIX + id }
  }
  if (/^https?:/i.test(href)) {
    const url = openableUrl(href)
    return url === null ? { kind: 'none' } : { kind: 'external', url }
  }
  if (base === null) return { kind: 'none' }
  const path = resolveRelative(base, href.replace(/[?#].*$/s, ''))
  return path === null ? { kind: 'none' } : { kind: 'file', path }
}

const TASK = /^\[([ xX])\][ \t]/

/**
 * `- [ ] ` and `- [x] ` at the start of a list item's first paragraph become a checkbox token
 * (rendered disabled), and the item gets a class.
 */
function taskLists(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (
      inline.type !== 'inline' ||
      tokens[i - 1].type !== 'paragraph_open' ||
      tokens[i - 2].type !== 'list_item_open'
    ) {
      continue
    }
    const first = inline.children?.[0]
    const match = first?.type === 'text' ? TASK.exec(first.content) : null
    if (!first || !match || !inline.children) continue
    first.content = first.content.slice(match[0].length - 1)
    const box = new state.Token('task_checkbox', 'input', 0)
    box.meta = { checked: match[1] !== ' ' }
    inline.children.unshift(box)
    tokens[i - 2].attrJoin('class', 'markdown-task-item')
  }
}

/** Every heading gets `md-<slug>` as its id, numbered when another heading has it. */
function headingIds(state: StateCore): void {
  const seen = new Map<string, number>()
  const tokens = state.tokens
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const text = (tokens[i + 1].children ?? [])
      .filter((t) => t.type === 'text' || t.type === 'code_inline')
      .map((t) => t.content)
      .join('')
    const base = slug(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    tokens[i].attrSet('id', HEADING_ID_PREFIX + (count === 0 ? base : `${base}-${count}`))
  }
}

function createMarkdown(): InstanceType<typeof MarkdownIt> {
  // The default preset: CommonMark with tables and strikethrough. No raw HTML (D10).
  const md = new MarkdownIt('default', { html: false, linkify: true, typographer: false })
  md.core.ruler.after('inline', 'bikube_task_lists', taskLists)
  md.core.ruler.after('inline', 'bikube_heading_ids', headingIds)
  md.renderer.rules.task_checkbox = (tokens: Token[], idx: number): string =>
    `<input type="checkbox" class="markdown-task" disabled${tokens[idx].meta?.checked ? ' checked' : ''}>`
  const escape = md.utils.escapeHtml
  md.renderer.rules.image = (tokens, idx, options, env, self): string => {
    const token = tokens[idx]
    const alt = self.renderInlineAsText(token.children ?? [], options, env)
    const src = String(token.attrGet('src') ?? '')
    // The render's `base`: the Markdown file's path in its folder, null for none.
    const base: unknown = (env as Record<string, unknown> | undefined)?.base
    const path = typeof base === 'string' ? resolveRelative(base, src) : null
    // Only a picture inside the folder loads (through main, as a `data:` URL); others show their alt.
    if (path === null) return `<span class="markdown-image-alt">${escape(alt)}</span>`
    const title = String(token.attrGet('title') ?? '')
    return `<img alt="${escape(alt)}"${title ? ` title="${escape(title)}"` : ''} data-md-src="${escape(path)}">`
  }
  return md
}

let markdown: ReturnType<typeof createMarkdown> | null = null

/**
 * `text` as the preview's HTML. `base` is the file's path relative to its folder, against which
 * relative images resolve; null loads none.
 */
export function renderMarkdown(text: string, base: string | null): string {
  markdown ??= createMarkdown()
  return markdown.render(text, { base })
}
