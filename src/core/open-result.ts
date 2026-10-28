/**
 * What opening a file from the Files tab gave, and its error line (#55 D13, D14). Plain TS with
 * no Node imports, so the renderer uses it too.
 */

/**
 * What an open request gave (D13, D16): `refused` when the path isn't a file inside the shown
 * folder (nothing run), `no-command` for an empty custom command, `failed` with the reason when
 * the editor couldn't be started; `default-app` when VS Code, Cursor or Zed wasn't found and the
 * file opened with the system's default app instead (#70 D3), with the editor's reason.
 */
export type OpenResult =
  | { ok: true }
  | { ok: true; reason: 'default-app'; message: string }
  | { ok: false; reason: 'refused' }
  | { ok: false; reason: 'no-command' }
  | { ok: false; reason: 'failed'; message: string }

/** Whether `result`'s line is a note, not an error (#70 D3): the file opened with the default app. */
export function isOpenNote(result: OpenResult): boolean {
  return result.ok && 'reason' in result
}

/**
 * The Files tab's line for opening `path` (D13, D14): `Couldn't open <file name>: <reason>`
 * when the editor couldn't be started, `Set a command in Settings > Editor` for an empty custom
 * command, and the note `Opened <file name> with the default app: <reason>` (#70 D3,
 * `isOpenNote`); null once opened, or when main refused the path (nothing ran, e.g. a nested
 * repository's folder listed as a changed file).
 */
export function openErrorLine(path: string, result: OpenResult): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (result.ok) {
    return 'reason' in result ? `Opened ${name} with the default app: ${result.message}` : null
  }
  if (result.reason === 'refused') return null
  if (result.reason === 'no-command') return 'Set a command in Settings > Editor'
  return `Couldn't open ${name}: ${result.message}`
}

/**
 * The Agent setup page's error line for Open file or Reveal on `path` (#68 D27): the Files tab's,
 * and for a path main refused (no longer a file its last read listed, so nothing ran)
 * `Couldn't open <file name>: file not found`, since the row's button promised a file.
 */
export function listedFileErrorLine(path: string, result: OpenResult): string | null {
  if (!result.ok && result.reason === 'refused') {
    return openErrorLine(path, { ok: false, reason: 'failed', message: 'file not found' })
  }
  return openErrorLine(path, result)
}
