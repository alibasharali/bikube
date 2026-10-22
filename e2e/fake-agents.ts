import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeClaudeHome, type FakeClaudeHome } from './fake-claude'

// The fake `codex`, `gemini` and `opencode` of #21's smoke tests: each appends `<name> <args>` as
// one line to the shared $BIKUBE_AGENT_LOG, prints `fake-<name> <args>`, and waits on stdin. With
// FAKE_AGENT_RESUME_FAILS=1 a resume run (`codex resume …`, `gemini --resume …`,
// `opencode --continue`) exits 1 at once.
function fakeAgent(name: string, resumeTest: string): string {
  return `#!/bin/bash
echo "${name}\${*:+ $*}" >> "$BIKUBE_AGENT_LOG"
echo "fake-${name}\${*:+ $*}"
if ${resumeTest} && [ "$FAKE_AGENT_RESUME_FAILS" = "1" ]; then exit 1; fi
read -r _
exit 0
`
}

const FAKE_AGENTS: Record<string, string> = {
  codex: fakeAgent('codex', '[ "$1" = "resume" ]'),
  gemini: fakeAgent('gemini', '[ "$1" = "--resume" ]'),
  opencode: fakeAgent('opencode', '[ "$1" = "--continue" ]')
}

export interface FakeAgentsHome extends FakeClaudeHome {
  /** The fake agents' shared log file: one `<name> <args>` line per run. */
  agentLog: string
}

/**
 * Puts the fake `codex`, `gemini` and `opencode` in `<home>/bin` (on the login PATH of a home made
 * by `fakeClaudeHome` or `fakeSshHome`), logging to `agentLog`. The .bash_profile exports the log
 * too, so a fake remote's cleared environment (#12's fake `ssh`) finds it.
 */
export function addFakeAgents(home: string, agentLog: string): void {
  for (const [name, script] of Object.entries(FAKE_AGENTS)) {
    const path = join(home, 'bin', name)
    writeFileSync(path, script)
    chmodSync(path, 0o755)
  }
  appendFileSync(
    join(home, '.bash_profile'),
    `[ -n "$BIKUBE_AGENT_LOG" ] || export BIKUBE_AGENT_LOG='${agentLog}'\n`
  )
}

/**
 * Makes `<root>/home` with the fake `claude` (`fakeClaudeHome`) and the fake agents on its login
 * PATH, the agents logging to `<root>/agents.log`.
 */
export function fakeAgentsHome(root: string): FakeAgentsHome {
  const claude = fakeClaudeHome(root)
  const agentLog = join(root, 'agents.log')
  addFakeAgents(claude.home, agentLog)
  return { ...claude, agentLog, env: { ...claude.env, BIKUBE_AGENT_LOG: agentLog } }
}

/** The fake agents' log, one line per run. */
export function agentLogLines(log: string): string[] {
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
    : []
}
