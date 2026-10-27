import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeVersionPlan, parseClaudeVersion, readClaudeVersion } from './claude-version'

// Status' Claude Code row (#68 D13): `claude --version` and `command -v claude` through the login
// shell, as the installed-agents check runs.

describe('claudeVersionPlan', () => {
  it('names claude as a positional argument of a POSIX login shell; fish gets $argv', () => {
    const plan = claudeVersionPlan('/bin/zsh')
    expect(plan.command).toBe('/bin/zsh')
    expect(plan.args.slice(0, 2)).toEqual(['-l', '-c'])
    expect(plan.args.slice(3)).toEqual(['bikube', 'claude'])
    expect(plan.args[2]).not.toContain('claude')
    expect(claudeVersionPlan('/usr/bin/fish').args[2]).toContain('$argv')
    expect(claudeVersionPlan('/usr/bin/nu').command).toBe('/bin/sh')
  })
})

describe('parseClaudeVersion', () => {
  it('reads only the marked lines, whatever a profile printed', () => {
    expect(
      parseClaudeVersion(
        'Welcome\nbikube-found /h/bin/claude\nbikube-version 2.1.0 (Claude Code)\n'
      )
    ).toEqual({ installed: true, path: '/h/bin/claude', version: '2.1.0 (Claude Code)' })
    expect(parseClaudeVersion('bikube-found /h/bin/claude\nbikube-version \n')).toEqual({
      installed: true,
      path: '/h/bin/claude',
      version: null
    })
    expect(parseClaudeVersion('Welcome\n')).toEqual({ installed: false })
  })
})

describe('readClaudeVersion', () => {
  let dir: string
  let bin: string
  let home: string
  let env: Record<string, string>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bikube-claude-version-'))
    bin = join(dir, 'bin')
    home = join(dir, 'home')
    mkdirSync(bin)
    mkdirSync(home)
    const profile = `echo Welcome back\nPATH='${bin}':/usr/bin:/bin; export PATH\n`
    for (const file of ['.profile', '.bash_profile', '.zprofile']) {
      writeFileSync(join(home, file), profile)
    }
    env = { HOME: home, ZDOTDIR: home, PATH: '/usr/bin:/bin' }
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const shells = ['/bin/sh', '/bin/bash', '/bin/zsh'].filter(
    (shell) => spawnSync(shell, ['-c', 'exit 0']).status === 0
  )

  for (const shell of shells) {
    it(`AC13: reads the version and path of claude on the login PATH of ${shell}`, async () => {
      writeFileSync(join(bin, 'claude'), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n")
      chmodSync(join(bin, 'claude'), 0o755)
      expect(await readClaudeVersion({ spawn, shell, env })).toEqual({
        installed: true,
        path: join(bin, 'claude'),
        version: '2.1.0 (Claude Code)'
      })
    })
  }

  it('AC13: reads the version and path under fish, where it is installed', async () => {
    const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(
      (path) => spawnSync(path, ['-c', 'exit 0']).status === 0
    )
    if (!fish) return
    mkdirSync(join(home, '.config', 'fish'), { recursive: true })
    writeFileSync(
      join(home, '.config', 'fish', 'config.fish'),
      `set -gx PATH '${bin}' /usr/bin /bin\n`
    )
    writeFileSync(join(bin, 'claude'), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n")
    chmodSync(join(bin, 'claude'), 0o755)
    const fishEnv = { ...env, XDG_CONFIG_HOME: join(home, '.config') }
    expect(await readClaudeVersion({ spawn, shell: fish, env: fishEnv })).toEqual({
      installed: true,
      path: join(bin, 'claude'),
      version: '2.1.0 (Claude Code)'
    })
    rmSync(join(bin, 'claude'))
    expect(await readClaudeVersion({ spawn, shell: fish, env: fishEnv })).toEqual({
      installed: false
    })
  })

  it('AC13: Not installed without claude; null when the check fails', async () => {
    expect(await readClaudeVersion({ spawn, shell: '/bin/sh', env })).toEqual({ installed: false })
    expect(await readClaudeVersion({ spawn, shell: join(dir, 'missing', 'zsh'), env })).toBeNull()
    writeFileSync(join(home, '.profile'), 'sleep 5\n')
    expect(await readClaudeVersion({ spawn, shell: '/bin/sh', env, timeoutMs: 300 })).toBeNull()
  })
})
