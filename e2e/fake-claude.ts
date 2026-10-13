import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The fake `claude` of #5's smoke tests: it logs its arguments to $DROVR_CLAUDE_LOG, prints
// them, and waits on stdin. With FAKE_CLAUDE_RESUME_FAILS=1 a `--resume` run fails at once.
const FAKE_CLAUDE = `#!/bin/bash
echo "$*" >> "$DROVR_CLAUDE_LOG"
echo "fake-claude $*"
if [ "$1" = "--resume" ] && [ "$FAKE_CLAUDE_RESUME_FAILS" = "1" ]; then exit 1; fi
read -r _
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
