import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SessionManager } from './session-manager'
import { sshShellLine } from './ssh-command'
import { spawnInDirectory } from './terminal-spawn'

describe('spawnInDirectory', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drovr-spawn-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts the session in the checked directory', async () => {
    const spawn = vi.fn(() => ({ id: '7', pid: 1234 }))
    const result = await spawnInDirectory({ cols: 80, rows: 24, cwd: dir }, spawn)
    expect(result).toEqual({ ok: true, id: '7' })
    expect(spawn).toHaveBeenCalledWith({ cols: 80, rows: 24, cwd: dir })
  })

  it('refuses a removed directory without starting a process', async () => {
    const spawn = vi.fn(() => ({ id: '1', pid: 1 }))
    const result = await spawnInDirectory({ cols: 80, rows: 24, cwd: join(dir, 'gone') }, spawn)
    expect(result).toEqual({ ok: false, reason: 'working directory not found' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses invalid paths and sizes without starting a process', async () => {
    const spawn = vi.fn(() => ({ id: '1', pid: 1 }))
    expect(await spawnInDirectory({ cols: 80, rows: 24, cwd: 'relative' }, spawn)).toEqual({
      ok: false,
      reason: 'invalid working directory'
    })
    expect(await spawnInDirectory({ cols: 80, rows: 24, cwd: undefined }, spawn)).toEqual({
      ok: false,
      reason: 'invalid working directory'
    })
    expect(await spawnInDirectory({ cols: 0, rows: 24, cwd: dir }, spawn)).toEqual({
      ok: false,
      reason: 'invalid terminal size'
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not start a process when the page went away during the check', async () => {
    const spawn = vi.fn(() => ({ id: '1', pid: 1 }))
    let current = true
    const pending = spawnInDirectory({ cols: 80, rows: 24, cwd: dir }, spawn, {
      stillCurrent: () => current
    })
    current = false
    expect(await pending).toEqual({ ok: false, reason: 'window reloaded' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a spawn failure as the reason', async () => {
    const spawn = vi.fn(() => {
      throw new Error('posix_spawnp failed.')
    })
    expect(await spawnInDirectory({ cols: 80, rows: 24, cwd: dir }, spawn)).toEqual({
      ok: false,
      reason: 'posix_spawnp failed.'
    })
  })

  it('starts a real shell in the directory through the session manager', async () => {
    const manager = new SessionManager()
    let output = ''
    manager.on('data', (_, data) => (output += data))
    const result = await spawnInDirectory({ cols: 80, rows: 24, cwd: dir }, (options) =>
      manager.spawn({ ...options, shell: '/bin/sh' })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    manager.write(result.id, 'pwd\r')
    await vi.waitFor(() => expect(output).toContain(dir), { timeout: 5000 })
    manager.killAll()
  })

  describe('with a host (#12 D5, D12)', () => {
    it('starts the SSH line in the home directory, never the given directory', async () => {
      const spawn = vi.fn(() => ({ id: '3', pid: 1 }))
      const result = await spawnInDirectory(
        { cols: 80, rows: 24, cwd: '/nope/remote', host: 'me@devbox' },
        spawn
      )
      expect(result).toEqual({ ok: true, id: '3' })
      const ssh = sshShellLine('me@devbox', '/nope/remote')
      expect(spawn).toHaveBeenCalledWith({ cols: 80, rows: 24, command: ssh.ok && ssh.line })
    })

    it('refuses a bad host or remote directory without starting a process', async () => {
      const spawn = vi.fn(() => ({ id: '1', pid: 1 }))
      expect(
        await spawnInDirectory(
          { cols: 80, rows: 24, cwd: '/tmp', host: '-oProxyCommand=touch /tmp/pwned' },
          spawn
        )
      ).toEqual({ ok: false, reason: 'invalid host' })
      expect(await spawnInDirectory({ cols: 80, rows: 24, cwd: '/tmp', host: 42 }, spawn)).toEqual({
        ok: false,
        reason: 'invalid host'
      })
      expect(
        await spawnInDirectory({ cols: 80, rows: 24, cwd: 'relative', host: 'devbox' }, spawn)
      ).toEqual({ ok: false, reason: 'invalid working directory' })
      expect(
        await spawnInDirectory({ cols: 0, rows: 24, cwd: '/tmp', host: 'devbox' }, spawn)
      ).toEqual({ ok: false, reason: 'invalid terminal size' })
      expect(spawn).not.toHaveBeenCalled()
    })

    it('treats a null host as local, keeping its checks', async () => {
      const spawn = vi.fn(() => ({ id: '1', pid: 1 }))
      expect(
        await spawnInDirectory({ cols: 80, rows: 24, cwd: join(dir, 'gone'), host: null }, spawn)
      ).toEqual({ ok: false, reason: 'working directory not found' })
      expect(await spawnInDirectory({ cols: 80, rows: 24, cwd: dir, host: null }, spawn)).toEqual({
        ok: true,
        id: '1'
      })
      expect(spawn).toHaveBeenCalledWith({ cols: 80, rows: 24, cwd: dir })
    })

    it('does not start an SSH process when the page went away', async () => {
      const spawn = vi.fn(() => ({ id: '1', pid: 1 }))
      const result = await spawnInDirectory(
        { cols: 80, rows: 24, cwd: '~', host: 'devbox' },
        spawn,
        { stillCurrent: () => false }
      )
      expect(result).toEqual({ ok: false, reason: 'window reloaded' })
      expect(spawn).not.toHaveBeenCalled()
    })
  })
})
