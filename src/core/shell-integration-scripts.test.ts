import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SessionManager } from './session-manager'
import { shellIntegrationStart } from './shell-integration'

// #45 AC4: Bikube's zsh, bash and fish integration scripts in real shells, started as Bikube starts
// them (`shellIntegrationStart`, `SessionManager.spawn`), with a home folder whose login files
// set a variable, a prompt showing the last status, and a hook printing the status it sees.
// A shell that isn't installed is skipped, except in CI, which installs all three.

const scriptsDir = resolve(__dirname, '..', '..', 'resources', 'shell-integration')

const OSC = (body: string): string => `\x1b]${body}\x07`

function installed(shell: string): string | null {
  try {
    return execFileSync('/bin/sh', ['-c', `command -v ${shell}`], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Skipped when the shell is missing locally; in CI a missing shell fails instead. */
function describeShell(name: string, body: (path: string) => void): void {
  const path = installed(name)
  if (path === null && process.env['CI']) {
    describe(name, () => {
      it('is installed in CI', () => {
        expect.fail(`${name} is missing: CI must install it for #45 AC4`)
      })
    })
    return
  }
  describe.skipIf(path === null)(`${name} with Bikube's integration`, { timeout: 30_000 }, () =>
    body(path ?? name)
  )
}

const managers: SessionManager[] = []
const folders: string[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.killAll()))
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bikube-shell-integration-'))
  folders.push(dir)
  return dir
}

/** The test process's variables kept out of the shells: only `start`'s environment counts. */
const STRIPPED = [
  'ZDOTDIR',
  'XDG_DATA_DIRS',
  'XDG_CONFIG_HOME',
  'PROMPT_COMMAND',
  'ENV',
  'BASH_ENV'
]

interface Shell {
  output(): string
  /** Types `line` and Enter. */
  run(line: string): void
  until(what: string, test: (output: string) => boolean): Promise<void>
}

/** Starts `shell` as Bikube does, in `home`, with `env` as the environment Bikube starts from. */
function start(shell: string, home: string, env: Record<string, string> = {}): Shell {
  const base: Record<string, string> = { HOME: home, SHELL: shell, ...env }
  const integration = shellIntegrationStart(shell, { enabled: true, scriptsDir, env: base })
  const m = new SessionManager()
  managers.push(m)
  let output = ''
  // The test's own environment (its SHELL, a developer's ZDOTDIR) stays out of the shell.
  const saved = Object.fromEntries(STRIPPED.map((key) => [key, process.env[key]]))
  for (const key of STRIPPED) delete process.env[key]
  let id: string
  try {
    ;({ id } = m.spawn({
      shell,
      cols: 200,
      rows: 50,
      cwd: home,
      args: integration.args,
      env: { ...base, ...integration.env }
    }))
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value
    }
  }
  m.on('data', (_, data) => {
    output += data
    // A terminal's answer to the primary device attributes query, which fish may wait for.
    if (data.includes('\x1b[c') || data.includes('\x1b[0c')) m.write(id, '\x1b[?62;22c')
  })
  return {
    output: () => output,
    run: (line) => m.write(id, `${line}\r`),
    until: async (what, test) => {
      const deadline = Date.now() + 8_000
      while (!test(output)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${what}; output:\n${JSON.stringify(output)}`)
        }
        await new Promise((r) => setTimeout(r, 20))
      }
    }
  }
}

/** The output as the user sees it: escape sequences and carriage returns removed. */
function visible(output: string): string {
  return (
    output
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[()][A-Z0-9]|\x1b[=>]/g, '')
      .replace(/\r/g, '')
  )
}

/** The OSC 133 and OSC 7 marks in `output`, in order. */
function marks(output: string): string[] {
  // eslint-disable-next-line no-control-regex
  return [...output.matchAll(/\x1b\](133;[^\x07]*|7;[^\x07]*)\x07/g)].map((m) => m[1]!)
}

const OSC7_TMP = OSC(`7;file://${hostname()}/tmp`)

/**
 * Runs `true`, `false` and `cd /tmp`, then checks the marks (A, B, C, D;0, then D;1, OSC 7 for
 * /tmp), the user's prompt showing the status it saw, and the login files' variable.
 */
async function checkScripts(sh: Shell, prompt: (status: number) => string): Promise<void> {
  await sh.until('the first prompt', (o) => visible(o).includes(prompt(0)))
  sh.run('true')
  await sh.until('D;0', (o) => o.includes(OSC('133;D;0')))
  sh.run('false')
  await sh.until('D;1', (o) => o.includes(OSC('133;D;1')))
  sh.run('cd /tmp')
  await sh.until('OSC 7 for /tmp', (o) => o.includes(OSC7_TMP))
  const seen = marks(sh.output())
  const a = seen.indexOf('133;A')
  const b = seen.indexOf('133;B', a)
  const c = seen.indexOf('133;C', b)
  const d0 = seen.indexOf('133;D;0', c)
  const d1 = seen.indexOf('133;D;1', d0)
  expect([a, b, c, d0, d1].every((i) => i >= 0)).toBe(true)
  // The prompt after `false` shows the user's own prompt with the status it saw.
  expect(visible(sh.output())).toContain(prompt(1))
  sh.run('echo "login=$TEST_LOGIN_VAR"')
  await sh.until('the login variable', (o) => visible(o).includes('login=from-login-files'))
}

/**
 * The environment of a shell started from `sh` (`<nested> -c env`), checked to hold none of
 * Bikube's injection variables, and a `ZDOTDIR` and `XDG_DATA_DIRS` without Bikube's folder.
 */
async function nestedEnv(sh: Shell, nested: string): Promise<Record<string, string>> {
  sh.run(`${nested} -c 'echo nested-"start"; env; echo nested-"end"'`)
  await sh.until('the nested shell', (o) => /nested-start\n[^]*nested-end\n/.test(visible(o)))
  const lines = visible(sh.output())
    .match(/nested-start\n([^]*)nested-end\n/)![1]!
    .split('\n')
  const env: Record<string, string> = {}
  for (const line of lines) {
    const eq = line.indexOf('=')
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1)
  }
  expect(Object.keys(env).filter((key) => key.startsWith('BIKUBE_'))).toEqual([])
  expect(env['ZDOTDIR'] ?? '').not.toContain(scriptsDir)
  expect(env['XDG_DATA_DIRS'] ?? '').not.toContain(scriptsDir)
  return env
}

describeShell('bash', (bash) => {
  /** bash's major and minor version: `\#` read through `${…@P}` (late subshell marks) needs 4.4. */
  const version = execFileSync(bash, ['-c', 'echo "${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}"'], {
    encoding: 'utf8'
  })
    .trim()
    .split(' ')
    .map(Number)
  const promptExpansion = version[0]! > 4 || (version[0] === 4 && version[1]! >= 4)

  /**
   * A command line that is one whole subshell runs no simple command in the shell itself (no
   * DEBUG trap): from bash 4.4 its C and D come at the next prompt, also for a line starting with
   * a space under HISTCONTROL=ignoreboth (in the login files); before 4.4 it gets none. An empty
   * Enter sends neither.
   */
  async function checkSubshell(sh: Shell): Promise<void> {
    const ends = (part: string): string[] =>
      marks(part).filter((m) => m === '133;C' || m.startsWith('133;D'))
    let from = sh.output().length
    sh.run('(exit 7)')
    if (promptExpansion) {
      await sh.until('D;7', (o) => o.slice(from).includes(OSC('133;D;7')))
      await sh.until('the next prompt', (o) => {
        const part = o.slice(from)
        return part.indexOf(OSC('133;A'), part.indexOf(OSC('133;D;7'))) > 0
      })
      expect(ends(sh.output().slice(from))).toEqual(['133;C', '133;D;7'])
      from = sh.output().length
    }
    sh.run('')
    await sh.until('the prompt after Enter', (o) => o.slice(from).includes(OSC('133;A')))
    sh.run('echo after-"enter"')
    await sh.until('the command after', (o) => visible(o.slice(from)).includes('\nafter-enter\n'))
    await sh.until('its D', (o) => o.slice(from).includes(OSC('133;D;0')))
    expect(ends(sh.output().slice(from))).toEqual(['133;C', '133;D;0'])
    if (!promptExpansion) return
    from = sh.output().length
    sh.run(' (cd /tmp && false)')
    await sh.until('D;1', (o) => o.slice(from).includes(OSC('133;D;1')))
    expect(ends(sh.output().slice(from))).toEqual(['133;C', '133;D;1'])
  }

  it('marks prompts and commands, keeps the login files, the prompt and $?', async () => {
    const home = folder()
    writeFileSync(
      join(home, '.bash_profile'),
      [
        'export TEST_LOGIN_VAR=from-login-files',
        "PS1='user[$?]> '",
        'PROMPT_COMMAND=\'echo "hook-saw-$?"\''
      ].join('\n') + '\n'
    )
    // Not read: bash reads only the first login file that exists.
    writeFileSync(join(home, '.profile'), 'export TEST_LOGIN_VAR=wrong-file\n')
    const sh = start(bash, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).toContain('hook-saw-1\n')
    expect(await nestedEnv(sh, bash)).not.toHaveProperty('PROMPT_COMMAND')
  })
  it("keeps the user's DEBUG trap and an array PROMPT_COMMAND, and marks commands inside functions once", async () => {
    const home = folder()
    writeFileSync(
      join(home, '.profile'),
      [
        'export TEST_LOGIN_VAR=from-login-files',
        "PS1='user[$?]> '",
        // bash 5.1's array form; on an older bash only its first element runs.
        'PROMPT_COMMAND=(\'echo "hook-saw-$?"\' \'echo "second-saw-$?"\')',
        'trap \'s=$?; [ "$BASH_COMMAND" = "echo traced" ] && echo "user-trap-saw-$s"\' DEBUG'
      ].join('\n') + '\n'
    )
    const sh = start(bash, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).toContain('hook-saw-1\nsecond-saw-1\n')
    sh.run('false; echo traced')
    await sh.until('the user trap', (o) => visible(o).includes('user-trap-saw-1'))
    sh.run('set -T; f() { true; true; }; f')
    await sh.until('the function', (o) => o.split(OSC('133;C')).length === 7)
    await sh.until('its end', (o) => o.split(OSC('133;D;0')).length === 6)
    // One C for the whole line, none for the commands inside `f`.
    expect(sh.output().split(OSC('133;C')).length).toBe(7)
  })

  it('marks a command line that is one whole subshell at the next prompt', async () => {
    const home = folder()
    writeFileSync(
      join(home, '.bash_profile'),
      ['export TEST_LOGIN_VAR=from-login-files', "PS1='user[$?]> '", 'HISTCONTROL=ignoreboth'].join(
        '\n'
      ) + '\n'
    )
    const sh = start(bash, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    await checkSubshell(sh)
  })

  it('percent-encodes OSC 7 by bytes and gives LC_ALL back as it was', async () => {
    for (const lcAll of [undefined, 'C.UTF-8']) {
      const home = folder()
      mkdirSync(join(home, 'a b é'))
      writeFileSync(join(home, '.bash_profile'), "PS1='user[$?]> '\n")
      const sh = start(bash, home, { LANG: 'C.UTF-8', ...(lcAll && { LC_ALL: lcAll }) })
      await sh.until('the first prompt', (o) => visible(o).includes('user[0]> '))
      sh.run(`cd 'a b é'`)
      await sh.until('OSC 7', (o) => o.includes(`${home}/a%20b%20%C3%A9\x07`))
      sh.run('echo "lc=[${LC_ALL-unset}]"')
      await sh.until('LC_ALL', (o) => visible(o).includes(`\nlc=[${lcAll ?? 'unset'}]\n`))
    }
  })

  it("works under the login files' `set -u` without an error", async () => {
    const home = folder()
    writeFileSync(
      join(home, '.bash_profile'),
      ['set -u', 'export TEST_LOGIN_VAR=from-login-files', "PS1='user[$?]> '"].join('\n') + '\n'
    )
    const sh = start(bash, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).not.toMatch(/unbound|bash:/)
  })

  describe('with bash-preexec (starship, atuin)', () => {
    const preexec = resolve(__dirname, 'fixtures', 'bash-preexec.sh')
    /** The user's hooks, through bash-preexec's arrays. */
    const hooks = ['preexec() { echo "user-preexec:$1"; }', 'precmd() { echo "user-precmd-$?"; }']

    function profile(lines: string[]): string {
      const home = folder()
      writeFileSync(
        join(home, '.bash_profile'),
        [
          'set -u',
          'export TEST_LOGIN_VAR=from-login-files',
          "PS1='user[$?]> '",
          'HISTCONTROL=ignoreboth',
          ...lines,
          ...hooks
        ].join('\n') + '\n'
      )
      return home
    }

    /**
     * Runs one command and the user's preexec hook sees it once, with one C and one D for it,
     * then `false` reaches the user's precmd hook as 1 with D;1.
     */
    async function checkHooks(sh: Shell): Promise<void> {
      const count = (text: string, part: string): number => text.split(part).length - 1
      let from = sh.output().length
      sh.run('echo marker-"x"')
      await sh.until('the marked command', (o) => o.slice(from).includes(OSC('133;D;0')))
      let part = sh.output().slice(from)
      expect(count(part, OSC('133;C'))).toBe(1)
      expect(count(part, OSC('133;D;0'))).toBe(1)
      expect(count(visible(part), '\nuser-preexec:echo marker-"x"\n')).toBe(1)
      expect(visible(part)).toContain('\nmarker-x\n')
      from = sh.output().length
      sh.run('false')
      await sh.until('D;1', (o) => o.slice(from).includes(OSC('133;D;1')))
      await sh.until('the precmd hook', (o) => visible(o.slice(from)).includes('user-precmd-1\n'))
      part = sh.output().slice(from)
      expect(count(part, OSC('133;C'))).toBe(1)
      expect(count(part, OSC('133;A'))).toBe(1)
      expect(visible(sh.output())).not.toMatch(/unbound|bash:/)
    }

    it('sourced by the login files, installing at the first prompt', async () => {
      const sh = start(bash, profile([`. '${preexec}'`]))
      await checkScripts(sh, (status) => `user[${status}]> `)
      await checkHooks(sh)
      await checkSubshell(sh)
    })

    it('sourced and installed at once by the login files', async () => {
      const sh = start(
        bash,
        profile([
          `__bp_delay_install=1`,
          `. '${preexec}'`,
          'unset __bp_delay_install',
          '__bp_install'
        ])
      )
      await checkScripts(sh, (status) => `user[${status}]> `)
      await checkHooks(sh)
      await checkSubshell(sh)
    })

    it('sourced at the prompt after Bikube loaded, keeping a DEBUG trap of the user', async () => {
      const sh = start(
        bash,
        profile(['trap \'[ "$BASH_COMMAND" = "echo traced" ] && echo "user-trap-ran"\' DEBUG'])
      )
      await checkScripts(sh, (status) => `user[${status}]> `)
      sh.run(`. '${preexec}'`)
      await sh.until('its install', (o) => visible(o).includes('user-precmd-0\n'))
      await checkHooks(sh)
      await checkSubshell(sh)
      sh.run('echo traced')
      await sh.until('the user trap', (o) => visible(o).includes('\nuser-trap-ran\n'))
    })
  })
})

describeShell('zsh', (zsh) => {
  /**
   * The user's `.zshenv` in `dir`, starting with `unsetopt GLOBAL_RCS`: zsh then skips the
   * system's /etc/zsh/zprofile, zshrc, zlogin and zlogout (Ubuntu's zshrc runs compinit, which
   * asks about insecure fpath folders on CI's runner, and isn't nounset-safe). Bikube's own
   * `.zshenv` sources this one, so it runs before zsh would read any of them.
   */
  function zshenv(dir: string, lines: string[] = []): void {
    writeFileSync(join(dir, '.zshenv'), ['unsetopt GLOBAL_RCS', ...lines].join('\n') + '\n')
  }

  /** A fresh HOME for a zsh test, kept away from the system's global rc files. */
  function zshHome(): string {
    const home = folder()
    zshenv(home)
    return home
  }

  /** The user's zsh files in `dir`: a login variable, a prompt and a precmd hook. */
  function userFiles(dir: string): void {
    zshenv(dir, ['ZSHENV_READ=yes'])
    writeFileSync(join(dir, '.zprofile'), 'export TEST_LOGIN_VAR=from-login-files\n')
    writeFileSync(
      join(dir, '.zshrc'),
      [
        "PS1='user[%?]> '",
        // A hook returning something else, so a later hook would see the wrong status if it leaked.
        'user_hook() { echo "hook-saw-$?"; return 7 }',
        'precmd_functions+=(user_hook)'
      ].join('\n') + '\n'
    )
  }

  it('marks prompts and commands with the user files in HOME, and unsets ZDOTDIR again', async () => {
    const home = zshHome()
    userFiles(home)
    const sh = start(zsh, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).toContain('hook-saw-1\n')
    sh.run('echo "zshenv=$ZSHENV_READ"')
    await sh.until('the .zshenv variable', (o) => visible(o).includes('zshenv=yes'))
    expect(await nestedEnv(sh, zsh)).not.toHaveProperty('ZDOTDIR')
  })

  it("reads the user's own ZDOTDIR and gives it back", async () => {
    const home = zshHome()
    const zdotdir = join(home, 'zdotdir')
    mkdirSync(zdotdir)
    userFiles(zdotdir)
    const sh = start(zsh, home, { ZDOTDIR: zdotdir })
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).toContain('hook-saw-1\n')
    expect((await nestedEnv(sh, zsh))['ZDOTDIR']).toBe(zdotdir)
  })

  it("marks the first prompt after the hooks the user's .zshrc adds (themes)", async () => {
    const home = zshHome()
    writeFileSync(
      join(home, '.zshrc'),
      [
        'export TEST_LOGIN_VAR=from-login-files',
        // A theme setting PS1 and printing a header line in precmd, as p10k, pure and oh-my-zsh do.
        'theme() { local s=$?; PS1="T[$s]%# "; print "\\nheader"; }',
        'precmd_functions+=(theme)'
      ].join('\n') + '\n'
    )
    const sh = start(zsh, home)
    await sh.until('the first prompt', (o) => o.includes(OSC('133;B')))
    const first = sh.output()
    const a = first.indexOf(OSC('133;A'))
    // A after the header, on the prompt's row; B after the theme's prompt.
    expect(a).toBeGreaterThan(first.indexOf('header'))
    expect(first.indexOf('header')).toBeGreaterThanOrEqual(0)
    expect(visible(first.slice(a, first.indexOf(OSC('133;B'))))).toMatch(/^T\[0\][%#] $/)
    // The first command's marks, with the theme still seeing its status.
    const from = first.length
    sh.run('false')
    await sh.until('D;1', (o) => o.slice(from).includes(OSC('133;D;1')))
    await sh.until('the next prompt', (o) => o.slice(from).includes(OSC('133;B')))
    const part = sh.output().slice(from)
    expect(marks(part).filter((m) => m.startsWith('133;'))).toEqual([
      '133;C',
      '133;D;1',
      '133;A',
      '133;B'
    ])
    const d = part.indexOf(OSC('133;D;1'))
    expect(part.indexOf('header', d)).toBeLessThan(part.indexOf(OSC('133;A')))
    expect(part.indexOf('header', d)).toBeGreaterThan(d)
    expect(visible(part)).toContain('T[1]')
  })

  /**
   * After a themed first prompt and two commands, the user's `zle-line-init` (defined by a
   * precmd hook after Bikube deferred its marks) ran at all three prompts and is still the widget.
   */
  async function checkLineInit(sh: Shell, counts: string, expected: string): Promise<void> {
    await sh.until('the first prompt', (o) => visible(o).includes('header'))
    for (const n of [1, 2]) {
      sh.run('true')
      await sh.until(`command ${n}`, (o) => o.split(OSC('133;D;0')).length === n + 1)
    }
    sh.run(`echo "${counts}"; zle -lL | grep -- zle-line-init; echo "listed"`)
    await sh.until('the widget list', (o) => visible(o).includes('\nlisted\n'))
    const out = visible(sh.output())
    expect(out).toContain(`\n${expected}\n`)
    expect(out).toMatch(/\nzle -N zle-line-init myinit\n/)
    expect(out).not.toContain('__bikube')
  }

  it('keeps a zle-line-init a later precmd hook defines', async () => {
    const home = zshHome()
    writeFileSync(
      join(home, '.zshrc'),
      [
        'theme() { PS1="T%# "; print "\\nheader"; }',
        'typeset -gi inits=0',
        'myinit() { (( inits++ )) }',
        // Defines the widget once, at the first prompt, after Bikube's hook (lazy plugins).
        'lazy() { zle -N zle-line-init myinit; precmd_functions=(${precmd_functions:#lazy}); }',
        'precmd_functions+=(theme lazy)'
      ].join('\n') + '\n'
    )
    await checkLineInit(start(zsh, home), 'inits=$inits', 'inits=3')
  })

  it('keeps a zle-line-init a later precmd hook wraps around the one it finds (zsh-vi-mode)', async () => {
    const home = zshHome()
    writeFileSync(
      join(home, '.zshrc'),
      [
        'theme() { PS1="T%# "; print "\\nheader"; }',
        'typeset -gi inits=0 bases=0',
        'base() { (( bases++ )) }',
        'zle -N zle-line-init base',
        'myinit() { (( inits++ )); zle orig-line-init -- "$@" }',
        'wrap() {',
        '  zle -A zle-line-init orig-line-init',
        '  zle -N zle-line-init myinit',
        '  precmd_functions=(${precmd_functions:#wrap})',
        '}',
        'precmd_functions+=(theme wrap)'
      ].join('\n') + '\n'
    )
    const sh = start(zsh, home)
    await checkLineInit(sh, 'inits=$inits bases=$bases', 'inits=3 bases=3')
    // Bikube's widget, wrapped, still marked the first prompt after the header.
    const out = sh.output()
    expect(out.indexOf(OSC('133;A'))).toBeGreaterThan(out.indexOf('header'))
    expect(out.indexOf(OSC('133;B'))).toBeGreaterThan(out.indexOf(OSC('133;A')))
  })

  it("works under the user's `setopt nounset` without an error", async () => {
    const home = zshHome()
    userFiles(home)
    zshenv(home, ['setopt nounset', 'ZSHENV_READ=yes'])
    const sh = start(zsh, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).not.toMatch(/parameter not set|zsh:/)
  })
})

describeShell('fish', (fish) => {
  /** The user's config: a login variable, a prompt showing $status and a postexec handler. */
  function userConfig(home: string): void {
    const dir = join(home, '.config', 'fish')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.fish'),
      [
        'set -gx TEST_LOGIN_VAR from-login-files',
        'function fish_greeting; end',
        'function fish_prompt; printf "user[%s]> " $status; end',
        'function user_hook --on-event fish_postexec; echo "hook-saw-$status"; end'
      ].join('\n') + '\n'
    )
  }

  it('marks prompts and commands, and takes its folder out of XDG_DATA_DIRS again', async () => {
    const home = folder()
    userConfig(home)
    const sh = start(fish, home)
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect(visible(sh.output())).toContain('hook-saw-1\n')
    await nestedEnv(sh, fish)
  })

  it('gives back an XDG_DATA_DIRS that was set', async () => {
    const home = folder()
    userConfig(home)
    const sh = start(fish, home, { XDG_DATA_DIRS: '/usr/share/test-data:/usr/share' })
    await checkScripts(sh, (status) => `user[${status}]> `)
    expect((await nestedEnv(sh, fish))['XDG_DATA_DIRS']).toContain('/usr/share/test-data')
  })
})
