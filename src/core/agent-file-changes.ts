/**
 * The file changes the Agent tab's What changed group reads from tool uses (#75 D9): sizes from an
 * edit's structured patch or its old and new strings, and the deletes and renames of simple
 * `rm`, `git rm`, `mv` and `git mv` steps with plain paths (no globs, variables or
 * substitutions). Nothing here runs a command. No Node imports: the renderer runs `joinPath` too.
 */
import { commandSteps } from './command-layout'

/** A change a command step made: `delete` of `path`, or `rename` of `path` to `to`. */
export interface CommandChange {
  kind: 'delete' | 'rename'
  path: string
  to?: string
}

/** `text`'s lines, a final newline ending the last rather than starting another. */
export function lineCount(text: string): number {
  if (text === '') return 0
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

const splitLines = (text: string): string[] => {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Lines added and removed replacing `before` with `after`, their common first and last lines left out. */
export function diffCount(before: string, after: string): { added: number; removed: number } {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++
  }
  return { added: b.length - start - end, removed: a.length - start - end }
}

/** The lines a structured patch (`[{ lines: ['+a', '-b', ' c'] }]`) adds and removes; null when it isn't one. */
export function patchCount(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch)) return null
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const lines = (hunk as { lines?: unknown }).lines
    if (!Array.isArray(lines)) return null
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

/** `path` with `.` and `..` resolved, `/`-separated; a relative path keeps its leading `..`. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith('/')
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
    } else out.push(part)
  }
  const joined = out.join('/')
  return absolute ? `/${joined}` : joined === '' ? '.' : joined
}

/** `path` resolved against `base` (null when unknown: `path` then stays relative). */
export function joinPath(base: string | null, path: string): string {
  if (path.startsWith('/') || base === null) return normalizePath(path)
  return normalizePath(`${base}/${path}`)
}

const PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/

/** A word that is a plain path, unquoted; null for globs, variables, substitutions and `~`. */
function plainWord(word: string): string | null {
  const single = /^'([^']+)'$/.exec(word)
  if (single) return single[1]
  const double = /^"([^"$`\\]+)"$/.exec(word)
  if (double) return double[1]
  return PLAIN.test(word) && !word.startsWith('-') ? word : null
}

/** The paths after a command's flags (each matching `flags`, or `--` ending them); null if any isn't plain. */
function operands(words: string[], flags: RegExp): string[] | null {
  const paths: string[] = []
  let flagsDone = false
  for (const word of words) {
    if (!flagsDone && word === '--') flagsDone = true
    else if (!flagsDone && word.startsWith('-')) {
      if (!flags.test(word)) return null
    } else {
      const path = plainWord(word)
      if (path === null) return null
      paths.push(path)
    }
  }
  return paths
}

const RM_FLAGS = /^(?:-[rRfvdi]+|--(?:recursive|force|verbose))$/
const GIT_RM_FLAGS = /^(?:-[rfq]+|--(?:force|quiet))$/
const MV_FLAGS = /^(?:-[fv]+|--(?:force|verbose))$/
const GIT_MV_FLAGS = /^(?:-[fkv]+|--(?:force|verbose))$/

const baseName = (path: string): string => path.slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1)

/**
 * The deletes and renames of `command`'s simple steps (split at `&&`, `||`, `;`, `|` and lines),
 * paths resolved against `cwd` and any plain `cd` before them; a step that isn't one of the four,
 * or names anything but plain paths, changes nothing; a `cd` the summary can't follow ends it.
 */
export function commandFileChanges(command: string, cwd: string | null): CommandChange[] {
  const changes: CommandChange[] = []
  let base = cwd
  for (const step of commandSteps(command)) {
    const words = step.parts.filter((p) => p.text.trim() !== '').map((p) => p.text)
    const [program, sub] = words
    if (program === 'cd') {
      const dir = words.length === 2 ? plainWord(words[1]) : null
      if (dir === null) break
      base = joinPath(base, dir)
      continue
    }
    if (program === 'rm' || (program === 'git' && sub === 'rm')) {
      const paths =
        program === 'rm'
          ? operands(words.slice(1), RM_FLAGS)
          : operands(words.slice(2), GIT_RM_FLAGS)
      if (paths === null) continue
      for (const path of paths) changes.push({ kind: 'delete', path: joinPath(base, path) })
    } else if (program === 'mv' || (program === 'git' && sub === 'mv')) {
      const paths =
        program === 'mv'
          ? operands(words.slice(1), MV_FLAGS)
          : operands(words.slice(2), GIT_MV_FLAGS)
      if (paths === null || paths.length !== 2) continue
      const [from, target] = paths
      const to = target.endsWith('/') ? `${target}${baseName(from)}` : target
      changes.push({ kind: 'rename', path: joinPath(base, from), to: joinPath(base, to) })
    }
  }
  return changes
}
