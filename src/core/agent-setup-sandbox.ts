/**
 * The Agent setup page's Sandbox section (#72): each settings file's `sandbox` object (D2), its
 * single values by precedence as facts (D3, D4) and its string lists merged across files (D3, D5),
 * the lists' entries filtered by the search (D6). Plain TS with no Node or DOM imports: the
 * renderer runs it.
 */

import { matchesQuery } from './agent-setup-rows'
import { sourceLabel, type AgentSetupSnapshot, type EntrySource } from './agent-setup-snapshot'

/** One fact (D4): a single value under `sandbox`, from the first file by precedence that sets it. */
export interface SandboxFact {
  /** Its dotted path under `sandbox`, e.g. `network.strictAllowlist`. */
  key: string
  label: string
  /** The value as written, else `Off` (Enabled) or `Not set`. */
  text: string
  /** Where it is set; absent when no file sets it. */
  source?: EntrySource
  file?: string
}

/** One list entry (D5), as written, with where it is set. */
export interface SandboxEntry {
  /** Its list's dotted path under `sandbox`. */
  key: string
  entry: string
  source: EntrySource
  file: string
}

/** One list (D5): its entries of every file, by precedence, matching the search (D6). */
export interface SandboxList {
  key: string
  label: string
  entries: SandboxEntry[]
}

export interface SandboxView {
  /** Never filtered by the search (D4). */
  facts: SandboxFact[]
  lists: SandboxList[]
  /** Whether any settings file sets a `sandbox` object (D8). */
  set: boolean
}

/** The known facts, in D4's order. */
const KNOWN_FACTS: readonly (readonly [string, string])[] = [
  ['enabled', 'Enabled'],
  ['failIfUnavailable', 'Fail if unavailable'],
  ['allowUnsandboxedCommands', 'Allow unsandboxed commands'],
  ['autoAllowBashIfSandboxed', 'Auto-allow Bash when sandboxed'],
  ['network.strictAllowlist', 'Strict allowlist'],
  ['network.allowLocalBinding', 'Allow local binding']
]

/** The known lists, in D5's order. */
const KNOWN_LISTS: readonly (readonly [string, string])[] = [
  ['network.allowedDomains', 'Allowed domains'],
  ['network.deniedDomains', 'Denied domains'],
  ['filesystem.allowWrite', 'Allow write'],
  ['filesystem.denyWrite', 'Deny write'],
  ['filesystem.allowRead', 'Allow read'],
  ['filesystem.denyRead', 'Deny read'],
  ['excludedCommands', 'Excluded commands']
]

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSingle = (value: unknown): value is boolean | number | string =>
  typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'

/** The Sandbox section's facts and lists from the three settings files (D2–D6). */
export function sandboxView(snapshot: AgentSetupSnapshot, query: string): SandboxView {
  const facts = new Map<string, SandboxFact>(
    KNOWN_FACTS.map(([key, label]) => [
      key,
      { key, label, text: key === 'enabled' ? 'Off' : 'Not set' }
    ])
  )
  const lists = new Map<string, SandboxList>(
    KNOWN_LISTS.map(([key, label]) => [key, { key, label, entries: [] }])
  )
  let set = false

  for (const file of snapshot.settings) {
    const sandbox = file.value?.['sandbox']
    if (!isObject(sandbox)) continue
    set = true
    const source: EntrySource = { kind: file.scope }
    const walk = (object: Record<string, unknown>, prefix: string): void => {
      for (const [name, value] of Object.entries(object)) {
        const key = prefix ? `${prefix}.${name}` : name
        if (isObject(value)) walk(value, key)
        else if (isSingle(value)) {
          const fact = facts.get(key)
          if (fact?.source) continue
          facts.set(key, {
            key,
            label: fact?.label ?? key,
            text: String(value),
            source,
            file: file.file
          })
        } else if (Array.isArray(value)) {
          const strings = value.filter((item): item is string => typeof item === 'string')
          // An array of objects (or of anything but strings) is no list (D5).
          if (strings.length === 0 && value.length > 0) continue
          let list = lists.get(key)
          if (!list) {
            list = { key, label: key, entries: [] }
            lists.set(key, list)
          }
          for (const entry of strings) {
            if (!matchesQuery(query, [entry, list.label, sourceLabel(source)])) continue
            list.entries.push({ key, entry, source, file: file.file })
          }
        }
      }
    }
    walk(sandbox, '')
  }
  return { facts: [...facts.values()], lists: [...lists.values()], set }
}

/** Every list entry of `view`: the rows the section counts (D6). */
export function sandboxEntries(view: SandboxView): SandboxEntry[] {
  return view.lists.flatMap((list) => list.entries)
}
