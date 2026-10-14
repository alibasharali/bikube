/**
 * The `board` command inside SSH cards (#25 D5, D6): a POSIX `sh` script that runs an embedded
 * client with `perl`, else `python3`, talking #9's protocol over the socket `ssh -R` forwards.
 * Both clients are generated from the local CLI's constants so they never drift from it. None of
 * the generated text contains a backslash, so the SSH line quotes the same under any local login
 * shell, fish included (#12 D3). Plain TS, no Node imports.
 */
import { BOARD_USAGE } from './board-args'
import { NOT_IN_A_CARD } from './board-commands'
import { ANSWER_TIMEOUT_MS, BOARD_PROTOCOL_VERSION, NO_ANSWER } from './board-protocol'

/** `DROVR_SOCKET` is not a socket owned by the remote user, or connecting to it fails (D6). */
export const CANT_REACH = "board: can't reach Drovr from this host"
/** The remote host has neither interpreter (D5). */
export const NEEDS_PERL_OR_PYTHON = 'board: needs perl or python3 on this host'

/** Characters kept as they are in a generated string literal; anything else becomes `chr(N)`. */
const PLAIN = /^[A-Za-z0-9 .,:;<>()_=+*?!/|~#%&[\]-]$/

/**
 * `text` as an expression valid in both perl and python: double-quoted runs of plain characters
 * and `chr(N)` for the rest, joined with `join`. No quote, backslash, `$` or `@` ever appears.
 */
function literal(text: string, join: string): string {
  const parts: string[] = []
  let run = ''
  for (const char of text) {
    if (PLAIN.test(char)) {
      run += char
      continue
    }
    if (run) parts.push(`"${run}"`)
    run = ''
    parts.push(`chr(${char.codePointAt(0)})`)
  }
  if (run || parts.length === 0) parts.push(`"${run}"`)
  return `(${parts.join(join)})`
}

const perlString = (text: string): string => literal(text, ' . ')
const pythonString = (text: string): string => literal(text, ' + ')

/** Whole seconds for perl's `alarm`, never less than the answer timeout. */
const TIMEOUT_SECONDS = Math.ceil(ANSWER_TIMEOUT_MS / 1000)

/**
 * The perl client: only core modules (`IO::Socket::UNIX`), arguments and environment taken as
 * bytes and sent as they are (raw UTF-8 is valid JSON), the reply's JSON decoded by hand.
 */
export function perlClient(): string {
  return `use strict;
use IO::Socket::UNIX;
my $B = chr(92);
my $Q = chr(34);
my $NL = chr(10);
my $USAGE = ${perlString(BOARD_USAGE)};
sub fail { binmode STDERR, ":utf8"; print STDERR $_[0], $NL; exit 1 }
my @a = @ARGV;
if (!@a || (@a == 1 && ($a[0] eq "help" || $a[0] eq "--help"))) { print STDOUT $USAGE; exit 0 }
if (!(@a == 3 && ($a[0] eq "move" || $a[0] eq "status"))) { print STDERR $USAGE; exit 2 }
my $id = $ENV{DROVR_CARD_ID};
my $path = $ENV{DROVR_SOCKET};
fail(${perlString(NOT_IN_A_CARD)}) unless defined $id && length $id && defined $path && length $path;
my @st = stat($path);
fail(${perlString(CANT_REACH)}) unless @st && -S _ && $st[4] == $>;
sub js {
  my $o = join "", map { my $c = ord; ($c < 32 || $c == 34 || $c == 92) ? sprintf("%su%04x", $B, $c) : $_ } split //, $_[0];
  return $Q . $o . $Q;
}
my $req = "{" . join(",", js("v") . ":" . ${BOARD_PROTOCOL_VERSION}, js("cardId") . ":" . js($id),
  js("command") . ":" . js($a[0]), js("card") . ":" . js($a[1]),
  js($a[0] eq "move" ? "column" : "text") . ":" . js($a[2])) . "}" . $NL;
$SIG{PIPE} = "IGNORE";
my $sock = IO::Socket::UNIX->new(Peer => $path) or fail(${perlString(CANT_REACH)});
my $got = "";
my $done = eval {
  local $SIG{ALRM} = sub { die "timeout" };
  alarm(${TIMEOUT_SECONDS});
  my $buf;
  syswrite($sock, $req);
  while (index($got, $NL) < 0) { my $n = sysread($sock, $buf, 4096); last unless $n; $got .= $buf; }
  alarm(0);
  1;
};
my $NO = ${perlString(NO_ANSWER)};
my $end = index($got, $NL);
fail($NO) unless $done && $end >= 0;
my $L = substr($got, 0, $end);
fail($NO) unless utf8::decode($L);
my $p = 0;
sub ch { return substr($L, $p, 1) }
sub ws { $p++ while $p < length($L) && index(" " . chr(9) . chr(10) . chr(13), ch()) >= 0 }
sub hex4 { my $h = substr($L, $_[0], 4); return ($h =~ /^[0-9a-fA-F]{4}/) ? hex($h) : -1 }
sub str {
  return undef unless ch() eq $Q;
  $p++;
  my $v = "";
  my %esc = ("n" => $NL, "t" => chr(9), "r" => chr(13), "b" => chr(8), "f" => chr(12), "/" => "/", $B => $B, $Q => $Q);
  while ($p < length $L) {
    my $c = ch();
    $p++;
    return $v if $c eq $Q;
    return undef if ord($c) < 32;
    if ($c ne $B) { $v .= $c; next }
    my $e = ch();
    $p++;
    if ($e eq "u") {
      my $n = hex4($p);
      return undef if $n < 0;
      $p += 4;
      if ($n >= 55296 && $n < 56320 && substr($L, $p, 2) eq $B . "u") {
        my $low = hex4($p + 2);
        if ($low >= 56320 && $low < 57344) { $n = 65536 + ($n - 55296) * 1024 + ($low - 56320); $p += 6 }
      }
      $v .= chr($n);
    } elsif (exists $esc{$e}) { $v .= $esc{$e} } else { return undef }
  }
  return undef;
}
sub val {
  ws();
  return ["s", str()] if ch() eq $Q;
  for my $w ("true", "false", "null") {
    if (substr($L, $p, length $w) eq $w) { $p += length $w; return [$w] }
  }
  return undef;
}
sub obj {
  ws();
  return undef unless ch() eq "{";
  $p++;
  my $o = {};
  ws();
  if (ch() eq "}") { $p++; return $o }
  while (1) {
    ws();
    my $k = str();
    return undef unless defined $k;
    ws();
    return undef unless ch() eq ":";
    $p++;
    my $v = val();
    return undef unless $v && ($v->[0] ne "s" || defined $v->[1]);
    $o->{$k} = $v;
    ws();
    my $c = ch();
    $p++;
    return $o if $c eq "}";
    return undef unless $c eq ",";
  }
}
my $r = obj();
ws();
fail($NO) unless $r && $p == length $L;
my $ok = $r->{ok};
exit 0 if $ok && $ok->[0] eq "true";
my $err = $r->{error};
fail($err->[1]) if $ok && $ok->[0] eq "false" && $err && $err->[0] eq "s";
fail($NO);
`
}

/** The python3 client: standard library only, arguments read as UTF-8 whatever the locale. */
export function pythonClient(): string {
  return `import json, os, socket, stat, sys, time
USAGE = ${pythonString(BOARD_USAGE)}
def out(stream, text, code):
    stream.buffer.write(text.encode("utf-8", "replace"))
    stream.flush()
    sys.exit(code)
def fail(text):
    out(sys.stderr, text + chr(10), 1)
def text(value):
    return os.fsencode(value).decode("utf-8", "replace")
a = [text(arg) for arg in sys.argv[1:]]
if not a or (len(a) == 1 and a[0] in ("help", "--help")):
    out(sys.stdout, USAGE, 0)
if not (len(a) == 3 and a[0] in ("move", "status")):
    out(sys.stderr, USAGE, 2)
card_id = text(os.environ.get("DROVR_CARD_ID", ""))
path = os.environ.get("DROVR_SOCKET", "")
if not card_id or not path:
    fail(${pythonString(NOT_IN_A_CARD)})
CANT = ${pythonString(CANT_REACH)}
NO = ${pythonString(NO_ANSWER)}
try:
    st = os.stat(path)
    good = stat.S_ISSOCK(st.st_mode) and st.st_uid == os.geteuid()
except OSError:
    good = False
if not good:
    fail(CANT)
deadline = time.monotonic() + ${ANSWER_TIMEOUT_MS / 1000}
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(${ANSWER_TIMEOUT_MS / 1000})
try:
    s.connect(path)
except OSError:
    fail(CANT)
key = "column" if a[0] == "move" else "text"
req = {"v": ${BOARD_PROTOCOL_VERSION}, "cardId": card_id, "command": a[0], "card": a[1], key: a[2]}
got = b""
try:
    s.sendall((json.dumps(req, separators=(",", ":")) + chr(10)).encode("utf-8", "surrogatepass"))
    while 10 not in got:
        left = deadline - time.monotonic()
        if left <= 0:
            break
        s.settimeout(left)
        chunk = s.recv(4096)
        if not chunk:
            break
        got += chunk
except OSError:
    pass
end = got.find(bytes([10]))
if end < 0:
    fail(NO)
try:
    reply = json.loads(got[:end].decode("utf-8"))
except ValueError:
    fail(NO)
if isinstance(reply, dict) and reply.get("ok") is True:
    sys.exit(0)
if isinstance(reply, dict) and reply.get("ok") is False and isinstance(reply.get("error"), str):
    fail(reply["error"])
fail(NO)
`
}

/** `text` single-quoted for a POSIX shell, a `'` written as `'"'"'`: no backslash (#12 D3). */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'"'"'`)}'`
}

/**
 * The remote `board` script (D5): runs the perl client when `perl` is on PATH, else the python3
 * client, else says it needs one of them, exit 1.
 */
export function remoteBoardScript(): string {
  return [
    '#!/bin/sh',
    `if command -v perl >/dev/null 2>&1; then exec perl -e ${shellQuote(perlClient())} -- "$@"; fi`,
    `if command -v python3 >/dev/null 2>&1; then exec python3 -c ${shellQuote(pythonClient())} "$@"; fi`,
    `echo ${shellQuote(NEEDS_PERL_OR_PYTHON)} >&2`,
    'exit 1',
    ''
  ].join('\n')
}
