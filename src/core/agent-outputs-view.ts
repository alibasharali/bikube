/**
 * The Agent tab's Files and artifacts rows (#79 D3, D4, D11): the summary's outputs newest first,
 * a file as its name over its folder (`~` for the home), an artifact as its title else its link
 * with a `Doc` or `Page` badge when known. No Node imports.
 */

import type { AgentOutput } from './agent-summary'
import { portableDirectory } from './sync-file'

export type OutputRow =
  | {
      kind: 'file'
      key: string
      /** The path as the summary gave it, for main's open and reveal (D10). */
      path: string
      name: string
      folder: string
    }
  | { kind: 'artifact'; key: string; url: string; title: string; badge: 'Doc' | 'Page' | null }

const BADGES = { doc: 'Doc', page: 'Page' } as const

function fileRow(path: string, home: string): OutputRow {
  const slash = path.lastIndexOf('/')
  const dir = slash <= 0 ? path.slice(0, slash + 1) : path.slice(0, slash)
  const folder = dir.startsWith('~') || home === '' ? dir : portableDirectory(dir, home)
  return { kind: 'file', key: path, path, name: path.slice(slash + 1), folder }
}

/** The rows for `outputs` (oldest first, as the summary keeps them), newest first. */
export function outputRows(outputs: AgentOutput[] | undefined, home: string): OutputRow[] {
  return (outputs ?? [])
    .slice()
    .reverse()
    .map((output) =>
      output.kind === 'file'
        ? fileRow(output.path, home)
        : {
            kind: 'artifact',
            key: output.url,
            url: output.url,
            title: output.title ?? output.url,
            badge: output.type ? BADGES[output.type] : null
          }
    )
}
