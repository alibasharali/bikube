/**
 * What opening a file from the Files tab gave, and its error line (#55 D13, D14). Plain TS with
 * no Node imports, so the renderer uses it too.
 */

/**
 * What an open request gave (D13, D16): `refused` when the path isn't a file inside the shown
 * folder (nothing run), `no-command` for an empty custom command, `failed` with the reason when
 * the editor couldn't be started.
 */
export type OpenResult =
  | { ok: true }
  | { ok: false; reason: 'refused' }
  | { ok: false; reason: 'no-command' }
  | { ok: false; reason: 'failed'; message: string }

/**
 * The Files tab's error line for opening `path` (D13, D14): `Couldn't open <file name>: <reason>`
 * when the editor couldn't be started, `Set a command in Settings > Editor` for an empty custom
 * command; null once opened, or when main refused the path (nothing ran, e.g. a nested
 * repository's folder listed as a changed file).
 */
export function openErrorLine(path: string, result: OpenResult): string | null {
  if (result.ok || result.reason === 'refused') return null
  if (result.reason === 'no-command') return 'Set a command in Settings > Editor'
  return `Couldn't open ${path.slice(path.lastIndexOf('/') + 1)}: ${result.message}`
}
