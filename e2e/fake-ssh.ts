import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { fakeClaudeHome, type FakeClaudeHome } from './fake-claude'

// The fake `ssh` of #12's smoke tests. It logs its arguments to $DROVR_SSH_LOG; for host
// `unreachable` it prints ssh's resolve error and exits 255; otherwise it runs the remote command
// with `sh -c` under a cleared environment, like a fresh login on the remote machine, whose
// TMPDIR is `<home>/tmp` so each session's `board` directory goes with the test's root (and
// `bash -l` reads this HOME's .bash_profile, so the fake `claude` is found there too).
// Each connection's arguments are logged on one line, newlines as spaces.
// FAKE_SSH_DELAY=<s>: first prints `Password:` and reads a hidden line for up to <s> seconds,
// as a password prompt would (so a start line typed too early is swallowed, never run).
// It also logs the local side's `board` variables to $DROVR_SSH_ENV_LOG (#12 D5: none).
// FAKE_SSH_FAIL_AFTER=<n>: every connection after the first <n> fails with exit code 255.
// `-R <remote>:<local>` (#25 D1): the forward is a real Unix socket listening at `<remote>` that
// relays each connection to `<local>` (FAKE_SSH_RELAY, a perl process; the remote client refuses a
// symlink, D3). It listens before the remote command runs and exits, removing `<remote>`, when the
// session's process is gone or hangs up; the remote command removes `<remote>` too when it ends.
// FAKE_SSH_NO_FORWARD=1 prints ssh's refusal warning instead and creates nothing, as a host with
// `AllowStreamLocalForwarding no` would. `-o <option>` is skipped.

/** In every fake relay process's arguments, so a leftover relay can be found with `ps`. */
export const RELAY_MARKER = 'drovr-fake-ssh-relay'

const FAKE_SSH = `#!/bin/bash
[ -n "$DROVR_SSH_ENV_LOG" ] && echo "card=[$DROVR_CARD_ID] bin=[$DROVR_BIN]" >> "$DROVR_SSH_ENV_LOG"
connections=0
[ -f "$DROVR_SSH_LOG" ] && connections=$(wc -l < "$DROVR_SSH_LOG")
# One line per connection: the remote command's newlines (its board script) as spaces.
args="$*"
echo "\${args//$'\\n'/ }" >> "$DROVR_SSH_LOG"
forward=
while [ $# -gt 0 ] && [ "$1" != "--" ]; do
  case "$1" in
    -R) forward=$2; shift ;;
    -o) shift ;;
  esac
  shift
done
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
if [ -n "$forward" ]; then
  remote="\${forward%%:*}"
  if [ "$FAKE_SSH_NO_FORWARD" = "1" ]; then
    echo "Warning: remote port forwarding failed for listen path $remote" >&2
  else
    # Returns once the relay listens (else perl says why, and no board, like ssh's warning); the
    # relay then watches this process, whose pid the exec below keeps for the remote command.
    perl "\${0%/*}/fake-ssh-relay" ${RELAY_MARKER} "$$" "$remote" "\${forward#*:}" </dev/null
  fi
fi
exec env -i HOME="$HOME" PATH=/usr/bin:/bin SHELL=/bin/bash TERM="$TERM" TMPDIR="$HOME/tmp" sh -c "$*"
`

/**
 * The fake forward (#25 D1): listens on <remote>, then forks into the background (its own session,
 * away from the terminal) and returns, so the remote command runs only once `board` can connect.
 * Each connection gets its own process relaying both ways to <local>; when one side ends its
 * output, the other side's write half is shut down, so EOF passes through in both directions.
 * The listener exits, removing <remote>, once the watched session process is gone (or a zombie),
 * or on a hangup or termination.
 */
const FAKE_SSH_RELAY = String.raw`use strict;
use IO::Socket::UNIX;
use IO::Select;
use POSIX ();
my (undef, $watch, $remote, $local) = @ARGV;
umask(0177);
my $server = IO::Socket::UNIX->new(Type => SOCK_STREAM(), Local => $remote, Listen => 16)
  or die "fake ssh: can't listen on $remote: $!
";
my $pid = fork();
die "fake ssh: fork: $!
" unless defined $pid;
POSIX::_exit(0) if $pid;
POSIX::setsid();
umask(0022);
open(STDOUT, ">", "/dev/null");
open(STDERR, ">", "/dev/null");
$SIG{CHLD} = "IGNORE";
$SIG{PIPE} = "IGNORE";
my $stop = sub { unlink $remote; POSIX::_exit(0) };
$SIG{HUP} = $stop;
$SIG{TERM} = $stop;
$SIG{INT} = $stop;
my $listening = IO::Select->new($server);
while (1) {
  $stop->() unless kill(0, $watch) && !zombie($watch);
  next unless $listening->can_read(0.1);
  my $client = $server->accept or next;
  my $child = fork();
  if (!defined $child || $child) { close $client; next }
  close $server;
  $SIG{$_} = "DEFAULT" for qw(HUP TERM INT);
  relay($client);
  POSIX::_exit(0);
}

sub zombie {
  open(my $fh, "<", "/proc/$_[0]/stat") or return 0;
  my $stat = <$fh>;
  return $stat =~ /\) Z /;
}

sub relay {
  my ($client) = @_;
  my $upstream = IO::Socket::UNIX->new(Type => SOCK_STREAM(), Peer => $local) or return;
  my %other = (fileno($client) => $upstream, fileno($upstream) => $client);
  my $open = IO::Select->new($client, $upstream);
  while ($open->count) {
    my @ready = $open->can_read(30) or return;
    for my $from (@ready) {
      my $to = $other{fileno($from)};
      my $n = sysread($from, my $buf, 65536);
      if (!$n) {
        $open->remove($from);
        shutdown($to, 1);
        next;
      }
      while (length $buf) {
        my $w = syswrite($to, $buf) or return;
        substr($buf, 0, $w) = "";
      }
    }
  }
}
`

export interface FakeSshHome extends FakeClaudeHome {
  /** The fake ssh's log file: one line of arguments per connection. */
  sshLog: string
  /** One line per connection: the local `board` variables ssh saw, `card=[…] bin=[…]`. */
  sshEnvLog: string
}

/**
 * Makes `<root>/home` with the fake `claude` and the fake `ssh` on its login PATH, logging to
 * `<root>/claude.log` and `<root>/ssh.log`. The fake remote's cleared environment gets the claude
 * log back from the .bash_profile.
 */
export function fakeSshHome(root: string): FakeSshHome {
  const claude = fakeClaudeHome(root)
  const sshLog = join(root, 'ssh.log')
  const sshEnvLog = join(root, 'ssh-env.log')
  const ssh = join(claude.home, 'bin', 'ssh')
  mkdirSync(join(claude.home, 'tmp'), { recursive: true })
  writeFileSync(ssh, FAKE_SSH)
  chmodSync(ssh, 0o755)
  writeFileSync(join(claude.home, 'bin', 'fake-ssh-relay'), FAKE_SSH_RELAY)
  appendFileSync(
    join(claude.home, '.bash_profile'),
    `[ -n "$DROVR_CLAUDE_LOG" ] || export DROVR_CLAUDE_LOG='${claude.log}'\n`
  )
  return {
    ...claude,
    sshLog,
    sshEnvLog,
    env: { ...claude.env, DROVR_SSH_LOG: sshLog, DROVR_SSH_ENV_LOG: sshEnvLog }
  }
}

/** The fake ssh's log, one line of arguments per connection. */
export function sshLogLines(log: string): string[] {
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
    : []
}

/**
 * Removes the remote ends of the forwards in the log (`-R <remote>:<local>`): a fake session
 * killed by its card's stop never gets the hangup a real `ssh` session gives its remote shell, so
 * the remote command can't clean them up itself then (its relay removes them too, but only once
 * it notices the session is gone).
 */
export function removeRemoteForwards(log: string): void {
  for (const line of sshLogLines(log)) {
    const remote = /^(?:-o \S+ )*-R (\S+?):/.exec(line)?.[1]
    if (remote?.startsWith('/tmp/drovr-')) rmSync(remote, { force: true })
  }
}
