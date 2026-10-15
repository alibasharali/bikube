/**
 * How an SSH card's shell runs (#12 D5): the user's local login shell runs
 * `exec ssh -t -- <host> <remote command>`, built here from the card's host and directory, both
 * re-checked by D2 and D3. The renderer never sends a command. Plain TS, no Node imports.
 */
import {
  CLAUDE_INSTRUCTION,
  CLAUDE_INSTRUCTION_FILE,
  CLAUDE_SETTINGS_FILE,
  claudeSettings
} from './claude-hooks'
import { remoteBoardScript, shellQuote } from './remote-board'
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
function remoteDirectory(directory: string, quoted: (text: string) => string = quote): string {
  if (directory === '~') return '~'
  if (directory.startsWith('~/')) return `~/${quoted(directory.slice(2))}`
  return quoted(directory)
}

/** What the remote side needs for `board` (#25 D4): the card and the forwarded socket's path. */
export interface RemoteBoard {
  cardId: string
  /** The remote end of the forward, `/tmp/drovr-<32 hex>.sock` (D3). */
  remoteSocket: string
}

/** What an SSH session needs for `board` (#25 D1, D7); `localSocket` null means no forward. */
export interface BoardForward extends RemoteBoard {
  /** Main's session socket the forward reaches, or null when main isn't listening (D7). */
  localSocket: string | null
}

/** A remote socket path that needs no quoting anywhere (D3 paths always pass). */
const REMOTE_SOCKET = /^\/[A-Za-z0-9._/-]+$/

/** Removes the private directory and the remote socket; never prints, never fails. */
const CLEANUP = `[ -z "$d" ] || rm -rf "$d" 2>/dev/null; rm -f "$DROVR_SOCKET" 2>/dev/null`

/**
 * The D4 setup between the `cd` and the ready marker: the card's variables, cleanup on exit,
 * hangup and termination, and, when `mktemp` works, the `board` script first on PATH. It never
 * prints anything or fails. Quoted without backslashes (#12 D3).
 */
function boardSetup({ cardId, remoteSocket }: RemoteBoard): string {
  return (
    `DROVR_CARD_ID=${shellQuote(cardId)}; DROVR_SOCKET=${shellQuote(remoteSocket)}; ` +
    'export DROVR_CARD_ID DROVR_SOCKET; d=; ' +
    `trap ${shellQuote(CLEANUP)} EXIT; ` +
    `trap ${shellQuote(`${CLEANUP}; exit 129`)} HUP; ` +
    `trap ${shellQuote(`${CLEANUP}; exit 143`)} TERM; ` +
    'd=$( (umask 077 && mktemp -d "${TMPDIR:-/tmp}/drovr.XXXXXXXX") 2>/dev/null) || d=; ' +
    `if [ -n "$d" ] && printf %s ${shellQuote(remoteBoardScript())} >"$d/board" 2>/dev/null && ` +
    'chmod 700 "$d/board" 2>/dev/null; then DROVR_BIN=$d; PATH=$d:$PATH; export DROVR_BIN PATH; ' +
    `${claudeSetup()}fi; `
  )
}

/**
 * Inside the `board` setup (#31 D14): copies of the Claude settings file and its instruction
 * beside `board`, removed with it, and `DROVR_CLAUDE_SETTINGS` naming the copy. The JSON's
 * backslashes (each `\"` in a hook command) are written as `$b`, a backslash `awk` prints, so
 * the command keeps none (#12 D3). When anything fails the variable stays unset.
 */
function claudeSetup(): string {
  const json = claudeSettings().split('\\').map(shellQuote).join(' "$b" ')
  return (
    `b=$(awk ${shellQuote('BEGIN { printf "%c", 92 }')} 2>/dev/null) || b=; ` +
    `if [ -n "$b" ] && printf %s ${json} >"$d/${CLAUDE_SETTINGS_FILE}" 2>/dev/null && ` +
    `printf %s ${shellQuote(`${CLAUDE_INSTRUCTION}\n`)} >"$d/${CLAUDE_INSTRUCTION_FILE}" 2>/dev/null; ` +
    `then DROVR_CLAUDE_SETTINGS=$d/${CLAUDE_SETTINGS_FILE}; export DROVR_CLAUDE_SETTINGS; fi; `
  )
}

/**
 * The command a POSIX remote login shell runs: `cd` to the directory (or exit 255, which shows
 * as SSH failed, D7), print the ready marker, then run the remote user's login shell. The shell
 * is not `exec`ed: its own exit status 255 is reported as 254, so only `ssh` itself or the failed
 * `cd` give 255. `directory` must already pass D3. With `board` (#25 D4) the `board` setup runs between the
 * `cd` and the marker, and everything is quoted without a backslash (#12 D3).
 */
export function remoteCommand(directory: string, board?: RemoteBoard): string {
  const cd = board
    ? `cd ${remoteDirectory(directory, shellQuote)} || exit 255; ${boardSetup(board)}`
    : `cd ${remoteDirectory(directory)} || exit 255; `
  return (
    cd +
    `printf '\\033]6973;drovr-ready\\007'; ` +
    `"\${SHELL:-/bin/sh}" -l; s=$?; [ $s = 255 ] && s=254; exit $s`
  )
}

export type SshLine = { ok: true; line: string } | { ok: false; reason: string }

/**
 * The line the local login shell runs with `-c` for an SSH card, or the refusal when the host
 * fails D2 or the directory fails D3. The host is quoted too, so `[` `]` are never globbed.
 * With `board` (#25 D1, D4) the remote command sets up `board`, and `-R <remote>:<local>`
 * forwards the socket unless there is no local socket or ssh would split its path at a `:` (D7),
 * after `-o ExitOnForwardFailure=no` so a user's config can't make a refused forward fatal;
 * the line then has no backslash but the marker's and never `\\` or `\'` (#12 D3). A card id
 * with a backslash or a remote path needing quotes can't be written that way and gets no `board`.
 */
export function sshShellLine(host: unknown, directory: unknown, board?: BoardForward): SshLine {
  const checkedHost = typeof host === 'string' ? checkHost(host) : null
  if (!checkedHost?.ok) return { ok: false, reason: SSH_REFUSAL.invalidHost }
  const checkedDirectory = typeof directory === 'string' ? checkRemoteDirectory(directory) : null
  if (!checkedDirectory?.ok) return { ok: false, reason: SSH_REFUSAL.invalidDirectory }
  if (
    !board ||
    !board.cardId ||
    board.cardId.includes('\\') ||
    !REMOTE_SOCKET.test(board.remoteSocket)
  ) {
    const command = remoteCommand(checkedDirectory.value)
    return { ok: true, line: `exec ssh -t -- ${quote(checkedHost.value)} ${quote(command)}` }
  }
  const { cardId, remoteSocket, localSocket } = board
  const forward =
    localSocket && !/[:\\]/.test(localSocket)
      ? `-o ExitOnForwardFailure=no -R ${shellQuote(`${remoteSocket}:${localSocket}`)} `
      : ''
  const command = remoteCommand(checkedDirectory.value, { cardId, remoteSocket })
  return {
    ok: true,
    line: `exec ssh ${forward}-t -- ${shellQuote(checkedHost.value)} ${shellQuote(command)}`
  }
}
