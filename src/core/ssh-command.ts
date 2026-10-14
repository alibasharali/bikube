/**
 * How an SSH card's shell runs (#12 D5): the user's local login shell runs
 * `exec ssh -t -- <host> <remote command>`, built here from the card's host and directory, both
 * re-checked by D2 and D3. The renderer never sends a command. Plain TS, no Node imports.
 */
import { checkHost, checkRemoteDirectory } from './ssh-location'

/** `ESC ] 6973 ; drovr-ready BEL`: the remote shell is about to start (D6). */
export const READY_MARKER = '\x1b]6973;drovr-ready\x07'

/** Why main refuses an SSH spawn (D12); shown after "Couldn't start: ". */
export const SSH_REFUSAL = {
  invalidHost: 'invalid host',
  invalidDirectory: 'invalid working directory'
} as const

/** `text` single-quoted for a POSIX shell: taken literally, `'` included. */
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** The directory for the remote shell: quoted, with a leading `~` or `~/` left to expand. */
function remoteDirectory(directory: string): string {
  if (directory === '~') return '~'
  if (directory.startsWith('~/')) return `~/${quote(directory.slice(2))}`
  return quote(directory)
}

/**
 * The command a POSIX remote login shell runs: `cd` to the directory (or exit 255, which shows
 * as SSH failed, D7), print the ready marker, then run the remote user's login shell. The shell
 * is not `exec`ed: its own exit status 255 is reported as 254, so only `ssh` itself or the failed
 * `cd` give 255. `directory` must already pass D3.
 */
export function remoteCommand(directory: string): string {
  return (
    `cd ${remoteDirectory(directory)} || exit 255; ` +
    `printf '\\033]6973;drovr-ready\\007'; ` +
    `"\${SHELL:-/bin/sh}" -l; s=$?; [ $s = 255 ] && s=254; exit $s`
  )
}

export type SshLine = { ok: true; line: string } | { ok: false; reason: string }

/**
 * The line the local login shell runs with `-c` for an SSH card, or the refusal when the host
 * fails D2 or the directory fails D3. The host is quoted too, so `[` `]` are never globbed.
 */
export function sshShellLine(host: unknown, directory: unknown): SshLine {
  const checkedHost = typeof host === 'string' ? checkHost(host) : null
  if (!checkedHost?.ok) return { ok: false, reason: SSH_REFUSAL.invalidHost }
  const checkedDirectory = typeof directory === 'string' ? checkRemoteDirectory(directory) : null
  if (!checkedDirectory?.ok) return { ok: false, reason: SSH_REFUSAL.invalidDirectory }
  const command = remoteCommand(checkedDirectory.value)
  return { ok: true, line: `exec ssh -t -- ${quote(checkedHost.value)} ${quote(command)}` }
}
