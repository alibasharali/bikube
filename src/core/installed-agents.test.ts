import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGENT_COMMANDS,
  installedPlan,
  parseInstalled,
  readInstalledAgents
} from './installed-agents'

describe('installedPlan', () => {
  it('checks every command through an interactive POSIX login shell, each a positional argument', () => {
    const plan = installedPlan('/bin/zsh', ['claude', '$(touch x)'])
    expect(plan.command).toBe('/bin/zsh')
    expect(plan.args.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    expect(plan.args.slice(4)).toEqual(['bikube', 'claude', '$(touch x)'])
    expect(plan.args[3]).not.toContain('claude')
  })

  it("uses fish's $argv under fish, and /bin/sh for a shell with neither syntax", () => {
    expect(installedPlan('/opt/homebrew/bin/fish', ['codex']).args.at(-1)).toBe('codex')
    expect(installedPlan('/opt/homebrew/bin/fish', ['codex']).args.slice(0, 3)).toEqual([
      '-l',
      '-i',
      '-c'
    ])
    expect(installedPlan('/opt/homebrew/bin/fish', ['codex']).args[3]).toContain('$argv')
    expect(installedPlan('/usr/bin/nu', ['codex']).command).toBe('/bin/sh')
  })
})

describe('parseInstalled', () => {
  it('reads only the marked lines, whatever a profile printed', () => {
    expect(
      parseInstalled('Welcome back\nbikube-found codex\nclaude\nbikube-found claude\n')
    ).toEqual(['claude', 'codex'])
    expect(parseInstalled('')).toEqual([])
  })

  it('knows each agent by its command', () => {
    expect(AGENT_COMMANDS).toEqual({
      claude: 'claude',
      codex: 'codex',
      gemini: 'gemini',
      opencode: 'opencode',
      pi: 'pi'
    })
  })
})

describe('readInstalledAgents', () => {
  let dir: string
  let bin: string
  let home: string
  let env: Record<string, string>

  /** A fake command in `bin`, which only the login shell's profile puts on PATH. */
  const fake = (name: string): void => {
    writeFileSync(join(bin, name), '#!/bin/sh\n')
    chmodSync(join(bin, name), 0o755)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bikube-agents-'))
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
    it(`finds the agents on the login PATH of ${shell}`, async () => {
      fake('claude')
      fake('opencode')
      expect(await readInstalledAgents({ spawn, shell, env })).toEqual(['claude', 'opencode'])
    })
  }

  // #78: Claude Code's and Codex's installers put ~/.local/bin on PATH in ~/.zshrc, which only an
  // interactive zsh reads, as a card's shell is.
  it("finds the agents zsh puts on PATH in .zshrc, as a card's shell does", async () => {
    const zsh = ['/bin/zsh', '/usr/bin/zsh'].find(
      (path) => spawnSync(path, ['-c', 'exit 0']).status === 0
    )
    if (!zsh) return
    writeFileSync(join(home, '.zprofile'), 'PATH=/usr/bin:/bin; export PATH\n')
    writeFileSync(join(home, '.zshrc'), `echo Welcome\nexport PATH='${bin}':$PATH\n`)
    fake('claude')
    fake('codex')
    expect(await readInstalledAgents({ spawn, shell: zsh, env })).toEqual(['claude', 'codex'])
  })

  it('finds the agents under fish, where it is installed', async () => {
    const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(
      (path) => spawnSync(path, ['-c', 'exit 0']).status === 0
    )
    if (!fish) return
    mkdirSync(join(home, '.config', 'fish'), { recursive: true })
    writeFileSync(
      join(home, '.config', 'fish', 'config.fish'),
      `set -gx PATH '${bin}' /usr/bin /bin\n`
    )
    fake('codex')
    expect(
      await readInstalledAgents({
        spawn,
        shell: fish,
        env: { ...env, XDG_CONFIG_HOME: join(home, '.config') }
      })
    ).toEqual(['codex'])
  })

  it('is empty when none is installed, and null when the check fails', async () => {
    expect(await readInstalledAgents({ spawn, shell: '/bin/sh', env })).toEqual([])
    // A POSIX shell's name at a path that doesn't exist: it is run as given, and fails.
    expect(await readInstalledAgents({ spawn, shell: join(dir, 'missing', 'zsh'), env })).toBeNull()
    writeFileSync(join(home, '.profile'), 'sleep 5\n')
    expect(await readInstalledAgents({ spawn, shell: '/bin/sh', env, timeoutMs: 300 })).toBeNull()
  })
})
