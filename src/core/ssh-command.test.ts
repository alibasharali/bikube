import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { READY_MARKER, remoteCommand, sshShellLine } from './ssh-command'

/** What `sh -c` makes of `script`'s words: each argument on its own line. */
function words(script: string): string[] {
  const out = execFileSync('/bin/sh', ['-c', `set -- ${script}; printf '%s\\n' "$@"`], {
    encoding: 'utf8'
  })
  return out.split('\n').slice(0, -1)
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
  })
})
