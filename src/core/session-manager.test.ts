import { afterEach, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { SessionManager, type SessionExit } from './session-manager'

const managers: SessionManager[] = []
function create(): SessionManager {
  const m = new SessionManager()
  managers.push(m)
  return m
}
afterEach(() => {
  managers.splice(0).forEach((m) => m.killAll())
})

function collect(m: SessionManager): {
  output: Map<string, string>
  exits: Map<string, SessionExit>
} {
  const output = new Map<string, string>()
  const exits = new Map<string, SessionExit>()
  m.on('data', (id, data) => output.set(id, (output.get(id) ?? '') + data))
  m.on('exit', (id, exit) => exits.set(id, exit))
  return { output, exits }
}

async function until(cond: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('SessionManager', () => {
  it('spawns a shell that echoes written input', async () => {
    const m = create()
    const { output } = collect(m)
    const { id } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 })
    m.write(id, 'echo hello\n')
    await until(() => /hello\r?\n/.test(output.get(id) ?? ''), 'echo output')
  })

  it('starts in the given cwd', async () => {
    const m = create()
    const { output } = collect(m)
    const { id } = m.spawn({ shell: '/bin/sh', cwd: '/tmp', cols: 80, rows: 24 })
    m.write(id, 'pwd\n')
    await until(() => /\/tmp\r?\n/.test(output.get(id) ?? ''), 'pwd output')
  })

  it('defaults to $SHELL (fallback /bin/bash) in the home directory', async () => {
    expect(SessionManager.defaultShell({ SHELL: '/bin/zsh' })).toBe('/bin/zsh')
    expect(SessionManager.defaultShell({})).toBe('/bin/bash')
    const m = create()
    const { output } = collect(m)
    const { id } = m.spawn({ cols: 80, rows: 24 })
    m.write(id, 'pwd\n')
    await until(() => (output.get(id) ?? '').includes(homedir()), 'home dir output')
  })

  it('resizes the PTY', async () => {
    const m = create()
    const { output } = collect(m)
    const { id } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 })
    m.resize(id, 50, 10)
    m.write(id, 'stty size\n')
    await until(() => /10 50\r?\n/.test(output.get(id) ?? ''), 'stty size')
  })

  it('reports the exit code when the shell exits', async () => {
    const m = create()
    const { exits } = collect(m)
    const { id } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 })
    m.write(id, 'exit 3\n')
    await until(() => exits.has(id), 'exit event')
    expect(exits.get(id)?.exitCode).toBe(3)
    expect(m.has(id)).toBe(false)
  })

  it('reports an exit when a session is killed, and the process is gone', async () => {
    const m = create()
    const { exits } = collect(m)
    const { id, pid } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 })
    expect(alive(pid)).toBe(true)
    m.kill(id)
    await until(() => exits.has(id), 'exit event')
    expect(typeof exits.get(id)?.exitCode).toBe('number')
    await until(() => !alive(pid), 'process exit')
  })

  it('leaves no PTY processes after killAll', async () => {
    const m = create()
    const { exits } = collect(m)
    const sessions = [0, 1, 2].map(() => m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 }))
    m.killAll()
    await until(() => exits.size === 3, 'all exits')
    await until(() => sessions.every((s) => !alive(s.pid)), 'no live processes')
    expect(m.size).toBe(0)
  })

  it('ignores operations on unknown sessions', () => {
    const m = create()
    expect(() => {
      m.write('nope', 'x')
      m.resize('nope', 10, 10)
      m.kill('nope')
    }).not.toThrow()
  })
})
