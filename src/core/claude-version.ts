/**
 * Status' Claude Code row (#68 D13): the version `claude --version` prints and the path
 * `command -v claude` gives, read through the user's login shell as the installed-agents check
 * runs (`LOGIN_CHECK`, the command a positional argument, each answer after a marker so whatever a
 * profile prints is ignored). Plain TS: main injects the process spawner, so Vitest runs real
 * shells on a fake `claude`.
 */

import {
  CHECK_DONE,
  finishedCheck,
  LOGIN_CHECK,
  runLoginShell,
  type InstalledDeps
} from './installed-agents'

/** What the check found: claude's path and its version's first line, or that it isn't there. */
export type ClaudeVersion =
  { installed: true; path: string; version: string | null } | { installed: false }

const FOUND = 'bikube-found'
const VERSION = 'bikube-version'

/** Shells that take POSIX `sh -c 'text' $0 $1…`. */
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'oksh', 'yash', 'ash'])

/**
 * How the login shell `shell` finds `claude` and asks its version, stdin closed: `claude` is a
 * positional argument, never in the text the shell parses; fish gets `$argv`, a shell with
 * neither syntax is replaced by `/bin/sh -l`.
 */
export function claudeVersionPlan(shell: string): { command: string; args: string[] } {
  const flavour = shell.slice(shell.lastIndexOf('/') + 1)
  if (flavour === 'fish') {
    return {
      command: shell,
      args: [
        ...LOGIN_CHECK,
        `if set p (command -v $argv[1]); printf '${FOUND} %s\\n' $p[1]; ` +
          `set v ($argv[1] --version </dev/null 2>/dev/null); printf '${VERSION} %s\\n' "$v[1]"; end; ` +
          `printf '${CHECK_DONE}\\n'; true`,
        'claude'
      ]
    }
  }
  return {
    command: POSIX_SHELLS.has(flavour) ? shell : '/bin/sh',
    args: [
      ...LOGIN_CHECK,
      `if p=$(command -v "$1" 2>/dev/null); then printf '${FOUND} %s\\n' "$p"; ` +
        `v=$("$1" --version </dev/null 2>/dev/null); printf '${VERSION} %s\\n' "$v"; fi; ` +
        `printf '${CHECK_DONE}\\n'; exit 0`,
      'bikube',
      'claude'
    ]
  }
}

/** The check's answer from its `stdout`: only the marked lines count. */
export function parseClaudeVersion(stdout: string): ClaudeVersion {
  const lines = stdout.split('\n')
  const marked = (marker: string): string | undefined =>
    lines
      .find((line) => line.startsWith(`${marker} `))
      ?.slice(marker.length + 1)
      .trim()
  const path = marked(FOUND)
  if (!path) return { installed: false }
  const version = marked(VERSION)
  return { installed: true, path, version: version ? version : null }
}

/**
 * Claude Code's version and path, or null when the check failed (no shell, an error, a timeout,
 * an rc file's `exec` cutting it short).
 */
export async function readClaudeVersion({
  shell,
  ...deps
}: InstalledDeps): Promise<ClaudeVersion | null> {
  const stdout = finishedCheck(await runLoginShell(claudeVersionPlan(shell), deps))
  return stdout === null ? null : parseClaudeVersion(stdout)
}
