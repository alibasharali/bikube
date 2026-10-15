import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardReply } from './board-protocol'
import { startBoardServer, type BoardServer } from './board-server'
import {
  CLAUDE_INSTRUCTION,
  CLAUDE_INSTRUCTION_FILE,
  CLAUDE_SETTINGS_FILE,
  claudeSettings
} from './claude-hooks'
import { shellQuote } from './remote-board'
import { READY_MARKER, remoteCommand, sshShellLine } from './ssh-command'

/** What `sh -c` makes of `script`'s words: each argument on its own line. */
function words(script: string): string[] {
  const out = execFileSync('/bin/sh', ['-c', `set -- ${script}; printf '%s\\n' "$@"`], {
    encoding: 'utf8'
  })
  return out.split('\n').slice(0, -1)
}

/** Like `words`, for arguments that may hold newlines: NUL-separated. */
function argv(script: string): string[] {
  const out = execFileSync('/bin/sh', ['-c', `set -- ${script}; printf '%s\\0' "$@"`], {
    encoding: 'utf8'
  })
  return out.split('\0').slice(0, -1)
}

/** The directory the remote shell `cd`s to for `directory`, with `$HOME` set to `home`. */
function remoteDirectory(directory: string, home: string): string {
  const command = remoteCommand(directory).replace(/; printf.*$/, '; printf %s "$PWD"')
  return execFileSync('/bin/sh', ['-c', command], {
    encoding: 'utf8',
    env: { HOME: home, PATH: '/usr/bin:/bin' }
  })
}

describe('remoteCommand (#12 D5)', () => {
  it('cds to the directory, prints the ready marker, then runs the login shell without exec', () => {
    expect(remoteCommand('/srv/api')).toBe(
      `cd '/srv/api' || exit 255; printf '\\033]6973;drovr-ready\\007'; ` +
        `"\${SHELL:-/bin/sh}" -l; s=$?; [ $s = 255 ] && s=254; exit $s`
    )
  })

  it('leaves a leading ~ or ~/ unquoted so the remote shell expands it', () => {
    expect(remoteCommand('~')).toMatch(/^cd ~ \|\| exit 255;/)
    expect(remoteCommand('~/x')).toMatch(/^cd ~\/'x' \|\| exit 255;/)
    expect(remoteDirectory('~', '/tmp')).toBe('/tmp')
    const home = mkdtempSync(join(tmpdir(), 'drovr-home-'))
    mkdirSync(join(home, "it's $x"))
    expect(remoteDirectory("~/it's $x", home)).toBe(join(home, "it's $x"))
    rmSync(home, { recursive: true })
  })

  it('keeps spaces, quotes and $ in a path literal', () => {
    for (const odd of [`/tmp/a b`, `/tmp/it's "x"`, '/tmp/$HOME', '/tmp/`id`;x']) {
      expect(remoteCommand(odd)).toContain(`cd '${odd.replace(/'/g, `'\\''`)}' ||`)
    }
    expect(remoteDirectory('/', '/tmp')).toBe('/')
  })

  it('exits 255 when the directory is missing', () => {
    let status = 0
    try {
      execFileSync('/bin/sh', ['-c', remoteCommand('/nope/remote')], { stdio: 'pipe' })
    } catch (error) {
      status = (error as { status: number }).status
    }
    expect(status).toBe(255)
  })

  it("reports the login shell's own exit 255 as 254 and passes other codes through", () => {
    const dir = mkdtempSync(join(tmpdir(), 'drovr-shell-'))
    const status = (code: number): number => {
      const shell = join(dir, `shell-${code}`)
      writeFileSync(shell, `#!/bin/sh\nexit ${code}\n`)
      chmodSync(shell, 0o755)
      try {
        execFileSync('/bin/sh', ['-c', remoteCommand(dir)], {
          stdio: 'pipe',
          env: { HOME: dir, PATH: '/usr/bin:/bin', SHELL: shell }
        })
        return 0
      } catch (error) {
        return (error as { status: number }).status
      }
    }
    expect(status(255)).toBe(254)
    expect(status(0)).toBe(0)
    expect(status(3)).toBe(3)
    rmSync(dir, { recursive: true })
  })

  it('prints the ready marker', () => {
    expect(READY_MARKER).toBe('\x1b]6973;drovr-ready\x07')
  })
})

describe('sshShellLine (#12 D5)', () => {
  it('builds `exec ssh -t -- <host> <remote command>` as the local shell reads it', () => {
    const result = sshShellLine('me@devbox', `/tmp/it's a $dir`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.line.startsWith('exec ssh -t -- ')).toBe(true)
    expect(words(result.line.replace(/^exec /, ''))).toEqual([
      'ssh',
      '-t',
      '--',
      'me@devbox',
      remoteCommand(`/tmp/it's a $dir`)
    ])
  })

  it('keeps a host with brackets from being globbed', () => {
    const result = sshShellLine('ssh://me@[::1]:22', '~/x')
    expect(result.ok && words(result.line.replace(/^exec /, ''))[3]).toBe('ssh://me@[::1]:22')
  })

  it('refuses a host failing D2 and a directory failing D3', () => {
    expect(sshShellLine('-oProxyCommand=touch /tmp/pwned', '/tmp')).toEqual({
      ok: false,
      reason: 'invalid host'
    })
    expect(sshShellLine('devbox', 'relative')).toEqual({
      ok: false,
      reason: 'invalid working directory'
    })
    expect(sshShellLine('devbox', '/tmp/a\nb')).toEqual({
      ok: false,
      reason: 'invalid working directory'
    })
    // A fish login shell would read `\'` in the quoted line as an escape (D3).
    expect(sshShellLine('devbox', "/x\\'; touch /tmp/pwned; #")).toEqual({
      ok: false,
      reason: 'invalid working directory'
    })
  })
})

describe('the SSH line with board (#25 D1, D4, D7)', () => {
  const board = { cardId: 'card-1', remoteSocket: '/tmp/drovr-r.sock', localSocket: '/l/s-1.sock' }

  it('forwards the remote socket to the local one before -t --, a refused forward never fatal', () => {
    const result = sshShellLine('me@devbox', '/srv/api', board)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.line.startsWith('exec ssh -o ExitOnForwardFailure=no -R ')).toBe(true)
    expect(argv(result.line.replace(/^exec /, ''))).toEqual([
      'ssh',
      '-o',
      'ExitOnForwardFailure=no',
      '-R',
      '/tmp/drovr-r.sock:/l/s-1.sock',
      '-t',
      '--',
      'me@devbox',
      remoteCommand('/srv/api', { cardId: 'card-1', remoteSocket: '/tmp/drovr-r.sock' })
    ])
  })

  it('has no forward without a local socket, or one ssh would split at a colon, but keeps the setup', () => {
    for (const localSocket of [null, '/a:b/s.sock']) {
      const result = sshShellLine('me@devbox', '/srv/api', { ...board, localSocket })
      expect(result.ok && argv(result.line.replace(/^exec /, ''))).toEqual([
        'ssh',
        '-t',
        '--',
        'me@devbox',
        remoteCommand('/srv/api', { cardId: 'card-1', remoteSocket: '/tmp/drovr-r.sock' })
      ])
    }
  })

  it('is fish-safe for any valid host and directory, and keeps the cd and 255 rules (AC8)', () => {
    const hosts = ['me@devbox', 'ssh://me@[::1]:22', 'a.b-c_d%e']
    const dirs = [
      '/',
      '~',
      '~/x',
      '/srv/api',
      `/tmp/it's "x"`,
      "/tmp/''",
      '/tmp/$HOME `id`;x',
      '/é/ü 🙂'
    ]
    for (const host of hosts) {
      for (const dir of dirs) {
        const result = sshShellLine(host, dir, { ...board, cardId: `it's "a" $x` })
        expect(result.ok).toBe(true)
        if (!result.ok) continue
        expect(result.line).not.toMatch(/\\[\\']/)
        expect(result.line.replace(/\\033|\\007/g, '')).not.toContain('\\')
        const command = argv(result.line.replace(/^exec /, '')).at(-1)!
        const quoted = dir === '~' ? '~' : dir === '~/x' ? `~/'x'` : shellQuote(dir)
        expect(command.startsWith(`cd ${quoted} || exit 255; `)).toBe(true)
        expect(command).toMatch(
          /"\$\{SHELL:-\/bin\/sh\}" -l; s=\$\?; \[ \$s = 255 \] && s=254; exit \$s$/
        )
      }
    }
  })

  it('ignores a card id with a backslash and a remote socket path it would have to quote', () => {
    for (const odd of [{ cardId: 'a\\' }, { remoteSocket: '/tmp/a b.sock' }]) {
      expect(sshShellLine('me@devbox', '/srv', { ...board, ...odd })).toEqual(
        sshShellLine('me@devbox', '/srv')
      )
    }
  })
})

describe('the remote command with board, run by sh (#25 D4)', () => {
  let dir: string
  let server: BoardServer | undefined
  let relay: Server | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drovr-rc-'))
  })

  afterEach(async () => {
    await server?.close()
    server = undefined
    await new Promise<void>((done) => (relay ? relay.close(() => done()) : done()))
    relay = undefined
    rmSync(dir, { recursive: true, force: true })
  })

  /** A remote login shell running `body`; it writes what it saw into `<dir>/seen`. */
  function shell(body: string): string {
    const path = join(dir, 'shell')
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
    return path
  }

  /** Runs the board remote command with `sh -c`, like the remote login shell would. */
  function runRemote(
    command: string,
    env: Record<string, string>,
    onSpawn?: (pid: number) => void
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('/bin/sh', ['-c', command], { env, detached: true })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (text: string) => (stdout += text))
      child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text))
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      if (onSpawn && child.pid) onSpawn(child.pid)
    })
  }

  const cardId = `it's "a" $x`

  it('sets up board, runs the login shell, then removes its directory and the remote socket', async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    const local = join(dir, 'board', 's-1.sock')
    server = await startBoardServer(local, handler)
    const remote = join(dir, 'drovr-r.sock')
    // The forward: a real socket at the remote path relaying to the local one, as ssh -R makes.
    relay = createServer({ allowHalfOpen: true }, (client) => {
      const upstream = connect(local)
      client.pipe(upstream).on('error', () => client.destroy())
      upstream.pipe(client).on('error', () => upstream.destroy())
    })
    await new Promise<void>((done) => relay!.listen(remote, done))
    const seen = join(dir, 'seen')
    const login = shell(
      `printf '%s|%s|%s|%s' "$DROVR_CARD_ID" "$DROVR_SOCKET" "$DROVR_BIN" "\${PATH%%:*}" > ${seen}\n` +
        `board status . hi || exit 9\nexit 3`
    )
    const result = await runRemote(remoteCommand(dir, { cardId, remoteSocket: remote }), {
      PATH: '/usr/bin:/bin',
      HOME: dir,
      SHELL: login
    })
    expect(result).toEqual({ code: 3, stdout: READY_MARKER, stderr: '' })
    const [id, socket, bin, first] = readFileSync(seen, 'utf8').split('|')
    expect([id, socket, first]).toEqual([cardId, remote, bin])
    expect(bin).toMatch(/\/drovr\.[A-Za-z0-9]{8}$/)
    expect(handler).toHaveBeenCalledWith({ v: 1, cardId, command: 'status', card: '.', text: 'hi' })
    expect(existsSync(bin)).toBe(false)
    expect(existsSync(remote)).toBe(false)
  })

  it('writes the Claude settings and instruction beside board, exports the path, removes them (#31 D14)', async () => {
    const seen = join(dir, 'seen')
    const copies = join(dir, 'copies')
    const login = shell(
      `printf '%s|%s' "$DROVR_BIN" "$DROVR_CLAUDE_SETTINGS" > ${seen}\n` +
        `cat "$DROVR_CLAUDE_SETTINGS" > ${copies}.json\n` +
        `cat "$DROVR_BIN/${CLAUDE_INSTRUCTION_FILE}" > ${copies}.txt`
    )
    const result = await runRemote(
      remoteCommand(dir, { cardId, remoteSocket: '/tmp/drovr-none.sock' }),
      { PATH: '/usr/bin:/bin', HOME: dir, SHELL: login }
    )
    expect(result).toEqual({ code: 0, stdout: READY_MARKER, stderr: '' })
    const [bin, settings] = readFileSync(seen, 'utf8').split('|')
    expect(settings).toBe(`${bin}/${CLAUDE_SETTINGS_FILE}`)
    expect(readFileSync(`${copies}.json`, 'utf8')).toBe(claudeSettings())
    expect(readFileSync(`${copies}.txt`, 'utf8')).toBe(`${CLAUDE_INSTRUCTION}\n`)
    expect(existsSync(settings)).toBe(false)
    expect(existsSync(bin)).toBe(false)
  })

  it("cds into a directory with quotes in its name and still reports the shell's 255 as 254", async () => {
    const odd = join(dir, `it's "odd" $x`)
    mkdirSync(odd)
    const seen = join(dir, 'seen')
    const result = await runRemote(
      remoteCommand(odd, { cardId, remoteSocket: '/tmp/drovr-none.sock' }),
      { PATH: '/usr/bin:/bin', HOME: dir, SHELL: shell(`pwd > ${seen}\nexit 255`) }
    )
    expect(result.code).toBe(254)
    expect(readFileSync(seen, 'utf8')).toBe(`${odd}\n`)
  })

  it('starts the shell with the card variables but no board when mktemp fails', async () => {
    const seen = join(dir, 'seen')
    const login = shell(
      `printf '%s|%s|%s|%s' "$DROVR_CARD_ID" "$DROVR_SOCKET" "\${DROVR_BIN-unset}" "$PATH" > ${seen}\n` +
        `printf %s "\${DROVR_CLAUDE_SETTINGS-unset}" > ${seen}-claude`
    )
    const result = await runRemote(
      remoteCommand(dir, { cardId, remoteSocket: '/tmp/drovr-none.sock' }),
      { PATH: '/usr/bin:/bin', HOME: dir, SHELL: login, TMPDIR: join(dir, 'missing') }
    )
    expect(result).toEqual({ code: 0, stdout: READY_MARKER, stderr: '' })
    expect(readFileSync(seen, 'utf8')).toBe(`${cardId}|/tmp/drovr-none.sock|unset|/usr/bin:/bin`)
    expect(readFileSync(`${seen}-claude`, 'utf8')).toBe('unset')
  })

  it.each([
    ['SIGHUP', 129],
    ['SIGTERM', 143]
  ] as const)('cleans up and exits %s → %i when the session ends', async (signal, code) => {
    const remote = join(dir, 'drovr-r.sock')
    writeFileSync(remote, '')
    const seen = join(dir, 'seen')
    const login = shell(`printf '%s' "$DROVR_BIN" > ${seen}\nsleep 30`)
    const result = await runRemote(
      remoteCommand(dir, { cardId, remoteSocket: remote }),
      { PATH: '/usr/bin:/bin', HOME: dir, SHELL: login },
      (pid) => {
        const poll = setInterval(() => {
          if (!existsSync(seen) || !readFileSync(seen, 'utf8')) return
          clearInterval(poll)
          process.kill(-pid, signal)
        }, 20)
      }
    )
    expect(result.code).toBe(code)
    expect(existsSync(readFileSync(seen, 'utf8'))).toBe(false)
    expect(existsSync(remote)).toBe(false)
  })
})
