/**
 * A skill's, agent's or command's frontmatter (#68 D18): the leading `---` block of simple
 * `key: value` YAML lines. Plain TS with no imports. Quoted values are unquoted, a `|` or `>` value
 * and indented lines after a key continue it, and `- item` lines after a key make a list; anything
 * else is `invalid`. No YAML library: nothing in these files is run or trusted.
 */

export type FrontmatterValue = string | string[]

export type Frontmatter =
  { kind: 'none' } | { kind: 'invalid' } | { kind: 'ok'; fields: Record<string, FrontmatterValue> }

const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*)|\s*)$/

const unquote = (value: string): string => {
  const v = value.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1)
  }
  return v
}

/** Parses `text`'s frontmatter: `none` without a leading `---` line, `invalid` when unreadable. */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { kind: 'none' }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return { kind: 'invalid' }
  const fields: Record<string, FrontmatterValue> = {}
  let key: string | null = null
  /** The current key's continuation: folded text, or a list. */
  let parts: string[] = []
  let list = false
  const flush = (): void => {
    if (key === null) return
    if (list) fields[key] = parts
    else if (parts.length > 0)
      fields[key] = [fields[key] as string, ...parts].filter(Boolean).join(' ')
    key = null
    parts = []
    list = false
  }
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line) || /^-\s/.test(line)) {
      // A continuation of the key above it.
      if (key === null) return { kind: 'invalid' }
      const item = /^\s*-\s+(.*)$/.exec(line)
      const current = fields[key]
      if (item && (list || current === '')) {
        list = true
        parts.push(unquote(item[1]!))
      } else if (!list) {
        parts.push(line.trim())
      } else {
        return { kind: 'invalid' }
      }
      continue
    }
    flush()
    const match = KEY_LINE.exec(line)
    if (!match) return { kind: 'invalid' }
    key = match[1]!
    const raw = (match[2] ?? '').trim()
    fields[key] = /^[|>][-+]?$/.test(raw) ? '' : unquote(raw)
  }
  flush()
  return { kind: 'ok', fields }
}

/** A field as one string: a list joined with `, `; undefined when absent or empty. */
export function fieldText(
  fields: Record<string, FrontmatterValue>,
  key: string
): string | undefined {
  const value = fields[key]
  if (value === undefined) return undefined
  const text = Array.isArray(value) ? value.join(', ') : value
  return text.trim() === '' ? undefined : text.trim()
}

/**
 * A field as a list: a list as it is, a string (or a `[a, b]` flow list) split on commas, each item
 * unquoted; undefined when absent or empty.
 */
export function fieldList(
  fields: Record<string, FrontmatterValue>,
  key: string
): string[] | undefined {
  const value = fields[key]
  if (value === undefined) return undefined
  // A flow list (`[Read, "Grep"]`) reads as its items.
  const text = Array.isArray(value)
    ? value
    : value
        .trim()
        .replace(/^\[(.*)\]$/, '$1')
        .split(',')
  const items = text.map(unquote).filter(Boolean)
  return items.length > 0 ? items : undefined
}
