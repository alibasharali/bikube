import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The Claude settings file a local card's `claude` gets in the built app (#31 D14). */
export const LOCAL_CLAUDE_SETTINGS = resolve(
  __dirname,
  '..',
  'resources',
  'bin',
  'claude-settings.json'
)

/** What a local Claude Code card's `claude` receives before its session flags (#31 D14). */
export const SETTINGS_ARGS = `--settings ${LOCAL_CLAUDE_SETTINGS}`

/**
 * A regular expression's source for what an SSH card's `claude` receives before its session flags:
 * the copy in the session's private directory (#31 D14).
 */
export const REMOTE_SETTINGS_ARGS = String.raw`--settings /\S*/drovr\.[A-Za-z0-9]{8}/claude-settings\.json`

const sessionIdLine = (id: string): string =>
  `claude --settings "$DROVR_CLAUDE_SETTINGS" --session-id ${id}`
const resumeIdLine = (id: string): string =>
  `claude --settings "$DROVR_CLAUDE_SETTINGS" --resume ${id}`

/**
 * The line a Claude Code card types until it has a conversation: the session id fresh, resumed
 * when it already exists (#31 D14).
 */
export const claudeFirstLine = (id: string): string => `${sessionIdLine(id)} || ${resumeIdLine(id)}`

/** The line a Claude Code card types once its hooks reported a conversation (#5 D5, #31 D14). */
export const claudeResumeLine = (id: string): string =>
  `${resumeIdLine(id)} || ${sessionIdLine(id)}`

// The fake `claude` of #5's smoke tests: it logs its arguments to $DROVR_CLAUDE_LOG, prints
// them, and waits on stdin. With FAKE_CLAUDE_RESUME_FAILS=1 a `--resume` run fails at once.
// A line on stdin is a message sent: like Drovr's real hook, it reports its session with
// `board session`, so the card resumes it next time.
const FAKE_CLAUDE = `#!/bin/bash
echo "$*" >> "$DROVR_CLAUDE_LOG"
echo "fake-claude $*"
case " $* " in *" --resume "*) [ "$FAKE_CLAUDE_RESUME_FAILS" = "1" ] && exit 1 ;; esac
id=
while [ $# -gt 0 ]; do
  case "$1" in --session-id|--resume) id=$2 ;; esac
  shift
done
read -r _
[ -n "$id" ] && "$DROVR_BIN/board" session . "$id" >/dev/null 2>&1
exit 0
`

export interface FakeClaudeHome {
  /** The HOME directory; its .bash_profile puts the fake `claude` first on PATH. */
  home: string
  /** The fake claude's log file. */
  log: string
  /** The environment to launch Electron with: bash as the login shell, this HOME and log. */
  env: Record<string, string>
}

/** Makes `<root>/home` with a fake `claude` on its login PATH, logging to `<root>/claude.log`. */
export function fakeClaudeHome(root: string): FakeClaudeHome {
  const home = join(root, 'home')
  const log = join(root, 'claude.log')
  mkdirSync(join(home, 'bin'), { recursive: true })
  writeFileSync(join(home, 'bin', 'claude'), FAKE_CLAUDE)
  chmodSync(join(home, 'bin', 'claude'), 0o755)
  writeFileSync(join(home, '.bash_profile'), 'export PATH="$HOME/bin:$PATH"\n')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  return { home, log, env: { ...env, SHELL: '/bin/bash', HOME: home, DROVR_CLAUDE_LOG: log } }
}

/** The fake claude's log, one line per run. */
export function claudeLogLines(log: string): string[] {
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
    : []
}
