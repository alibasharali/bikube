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

  it('adds the given environment variables to the shell (#9 D3)', async () => {
    const m = create()
    const { output } = collect(m)
    const { id } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24, env: { DROVR_X: 'card-7' } })
    m.write(id, 'echo "x=$DROVR_X"\n')
    await until(() => /x=card-7\r?\n/.test(output.get(id) ?? ''), 'env output')
  })

  it('runs the login shell with -c and a command, in the home directory (#12 D5)', async () => {
    const m = create()
    const { output, exits } = collect(m)
    const { id } = m.spawn({ shell: '/bin/bash', cols: 80, rows: 24, command: 'pwd; exit 255' })
    await until(() => exits.has(id), 'exit')
    expect(exits.get(id)?.exitCode).toBe(255)
    expect(output.get(id)).toContain(homedir())
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

  it('holds back output while paused and delivers it on resume (#16 D1)', async () => {
    const m = create()
    const { output } = collect(m)
    const { id } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 })
    m.write(id, 'echo ready\n')
    await until(() => /ready\r?\n/.test(output.get(id) ?? ''), 'ready')
    m.pause(id)
    const before = output.get(id) ?? ''
    m.write(id, 'echo held\n')
    await new Promise((r) => setTimeout(r, 300))
    expect(output.get(id)).toBe(before)
    m.resume(id)
    await until(() => /held\r?\n/.test(output.get(id) ?? ''), 'held output')
  })

  it('resumes a paused session before killing it, so its exit still arrives (#16 D5)', async () => {
    const m = create()
    const { output, exits } = collect(m)
    const { id, pid } = m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 })
    m.write(id, 'yes drovr-flow\n')
    await new Promise((r) => setTimeout(r, 200))
    m.pause(id)
    // While paused, `yes` fills the PTY's buffer.
    await new Promise((r) => setTimeout(r, 100))
    const atKill = output.get(id)?.length ?? 0
    m.kill(id)
    // A pause after the kill must not hold the shell's last output back either.
    m.pause(id)
    await until(() => exits.has(id), 'exit event', 5_000)
    // Resumed: what the shell printed until its hangup was read, not dropped.
    expect(output.get(id)?.length ?? 0).toBeGreaterThan(atKill)
    await until(() => !alive(pid), 'process exit')
  })

  it('resumes paused sessions before killAll (#16 D5)', async () => {
    const m = create()
    const { output, exits } = collect(m)
    const sessions = [0, 1].map(() => m.spawn({ shell: '/bin/sh', cols: 80, rows: 24 }))
    sessions.forEach(({ id }) => m.write(id, 'yes drovr-flow\n'))
    await new Promise((r) => setTimeout(r, 200))
    sessions.forEach(({ id }) => m.pause(id))
    await new Promise((r) => setTimeout(r, 100))
    const atKill = sessions.map(({ id }) => output.get(id)?.length ?? 0)
    m.killAll()
    await until(() => exits.size === 2, 'all exits', 5_000)
    sessions.forEach(({ id }, i) => expect(output.get(id)?.length ?? 0).toBeGreaterThan(atKill[i]))
  })

  it('resumes a paused session whose shell exits by itself, so its last output arrives (#16 D1, D5)', async () => {
    const m = create()
    const { output, exits } = collect(m)
    const { id } = m.spawn({
      shell: '/bin/sh',
      cols: 80,
      rows: 24,
      command: 'sleep 0.3; head -c 2000 /dev/zero | tr "\\0" x; echo TAIL-MARKER'
    })
    await new Promise((r) => setTimeout(r, 100))
    // Paused and never resumed: node-pty drops unread output 200 ms after the child is reaped.
    m.pause(id)
    await until(() => exits.has(id), 'exit event', 5_000)
    expect(output.get(id) ?? '').toContain('TAIL-MARKER')
    // Ending now: never paused again.
    m.pause(id)
  })

  it('ignores operations on unknown sessions', () => {
    const m = create()
    expect(() => {
      m.write('nope', 'x')
      m.resize('nope', 10, 10)
      m.kill('nope')
      m.pause('nope')
      m.resume('nope')
    }).not.toThrow()
  })
})
