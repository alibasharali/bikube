/**
 * Which of Settings > Editor's VS Code, Cursor and Zed are installed (#70 D2), so its select can
 * show the others disabled. Read through the user's login shell as the installed agents are, with
 * the same candidates (D1) and the same test of each as opening a file uses
 * (`POSIX_CANDIDATE_TEST`, `FISH_CANDIDATE_TEST`), so the select marks exactly what can't open.
 * Plain TS: main injects the process spawner, so Vitest runs real shells on fake commands.
 */

import {
  FISH_CANDIDATE_TEST,
  POSIX_CANDIDATE_TEST,
  POSIX_SHELLS,
  type EditorLocation
} from './editor'
import { editorCandidates, NAMED_EDITORS, type NamedEditor } from './editor-candidates'
import { runLoginShell, type InstalledDeps } from './installed-agents'

/** Each found editor's line, so whatever a login profile prints is never read as one. */
const FOUND = 'bikube-found'

/** Per editor: its id, the number of its candidates, then the candidates. */
const POSIX_CHECK =
  'while [ "$#" -gt 0 ]; do bikube_e=$1; bikube_n=$2; shift 2; bikube_f=; ' +
  'while [ "$bikube_n" -gt 0 ]; do bikube_c=$1; shift; bikube_n=$((bikube_n - 1)); ' +
  `if [ -z "$bikube_f" ] && ${POSIX_CANDIDATE_TEST}; then bikube_f=1; fi; done; ` +
  `[ -n "$bikube_f" ] && printf '${FOUND} %s\\n' "$bikube_e"; done; exit 0`

const FISH_CHECK =
  'set -l i 1; while test $i -le (count $argv); set -l e $argv[$i]; set -l n $argv[(math $i + 1)]; set -l f; ' +
  'for c in $argv[(math $i + 2)..(math $i + 1 + $n)]; ' +
  `if test -z "$f"; and ${FISH_CANDIDATE_TEST}; set f 1; end; end; ` +
  `test -n "$f"; and printf '${FOUND} %s\\n' $e; set i (math $i + 2 + $n); end; true`

/**
 * How the login shell `shell` checks every named editor's candidates on `platform` with `home`
 * as `~`: they are positional arguments, never in the text the shell parses; fish gets `$argv`, a
 * shell with neither syntax is replaced by `/bin/sh -l`.
 */
export function installedEditorsPlan(
  shell: string,
  platform: string,
  home: string
): { command: string; args: string[] } {
  const positional = NAMED_EDITORS.flatMap((editor) => {
    const candidates = editorCandidates(editor, platform, home)
    return [editor, String(candidates.length), ...candidates]
  })
  const flavour = shell.slice(shell.lastIndexOf('/') + 1)
  if (flavour === 'fish') return { command: shell, args: ['-l', '-c', FISH_CHECK, ...positional] }
  return {
    command: POSIX_SHELLS.has(flavour) ? shell : '/bin/sh',
    args: ['-l', '-c', POSIX_CHECK, 'bikube', ...positional]
  }
}

/** The editors the check's `stdout` found, in the select's order. */
export function parseInstalledEditors(stdout: string): NamedEditor[] {
  const found = new Set(
    stdout
      .split('\n')
      .filter((line) => line.startsWith(`${FOUND} `))
      .map((line) => line.slice(FOUND.length + 1).trim())
  )
  return NAMED_EDITORS.filter((editor) => found.has(editor))
}

/**
 * The installed editors; null when the check failed (the shell missing, a non-zero exit, a
 * timeout), so nothing is shown as not installed.
 */
export async function readInstalledEditors({
  shell,
  platform,
  home,
  ...deps
}: InstalledDeps & EditorLocation): Promise<NamedEditor[] | null> {
  const stdout = await runLoginShell(installedEditorsPlan(shell, platform, home), deps)
  return stdout === null ? null : parseInstalledEditors(stdout)
}
