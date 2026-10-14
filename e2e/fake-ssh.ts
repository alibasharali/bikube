import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeClaudeHome, type FakeClaudeHome } from './fake-claude'

// The fake `ssh` of #12's smoke tests. It logs its arguments to $DROVR_SSH_LOG; for host
// `unreachable` it prints ssh's resolve error and exits 255; otherwise it runs the remote command
// with `sh -c` under a cleared environment, like a fresh login on the remote machine (whose
// `bash -l` reads this HOME's .bash_profile, so the fake `claude` is found there too).
// FAKE_SSH_DELAY=<s>: first prints `Password:` and reads a hidden line for up to <s> seconds,
// as a password prompt would (so a start line typed too early is swallowed, never run).
// FAKE_SSH_FAIL_AFTER=<n>: every connection after the first <n> fails with exit code 255.
const FAKE_SSH = `#!/bin/bash
connections=0
[ -f "$DROVR_SSH_LOG" ] && connections=$(wc -l < "$DROVR_SSH_LOG")
echo "$*" >> "$DROVR_SSH_LOG"
while [ $# -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift
host=$1
shift
if [ "$host" = "unreachable" ]; then
  echo "ssh: Could not resolve hostname unreachable: Name or service not known" >&2
  exit 255
fi
if [ -n "$FAKE_SSH_FAIL_AFTER" ] && [ "$connections" -ge "$FAKE_SSH_FAIL_AFTER" ]; then
  echo "ssh: connect to host $host port 22: Connection refused" >&2
  exit 255
fi
if [ -n "$FAKE_SSH_DELAY" ]; then
  printf 'Password: '
  IFS= read -rs -t "$FAKE_SSH_DELAY" _
  printf '\\r\\n'
fi
exec env -i HOME="$HOME" PATH=/usr/bin:/bin SHELL=/bin/bash TERM="$TERM" sh -c "$*"
`

export interface FakeSshHome extends FakeClaudeHome {
  /** The fake ssh's log file: one line of arguments per connection. */
  sshLog: string
}

/**
 * Makes `<root>/home` with the fake `claude` and the fake `ssh` on its login PATH, logging to
 * `<root>/claude.log` and `<root>/ssh.log`. The fake remote's cleared environment gets the claude
 * log back from the .bash_profile.
 */
export function fakeSshHome(root: string): FakeSshHome {
  const claude = fakeClaudeHome(root)
  const sshLog = join(root, 'ssh.log')
  const ssh = join(claude.home, 'bin', 'ssh')
  writeFileSync(ssh, FAKE_SSH)
  chmodSync(ssh, 0o755)
  appendFileSync(
    join(claude.home, '.bash_profile'),
    `[ -n "$DROVR_CLAUDE_LOG" ] || export DROVR_CLAUDE_LOG='${claude.log}'\n`
  )
  return { ...claude, sshLog, env: { ...claude.env, DROVR_SSH_LOG: sshLog } }
}

/** The fake ssh's log, one line of arguments per connection. */
export function sshLogLines(log: string): string[] {
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
    : []
}
