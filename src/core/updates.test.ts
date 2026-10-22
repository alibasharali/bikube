import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assetName,
  formatSize,
  INSTALL_SCRIPT,
  installMessage,
  installPaths,
  installTarget,
  isNewer,
  MAX_ASSET_BYTES,
  newerRelease,
  parseVersion,
  RELEASES_URL,
  WaitingRechecks
} from './updates'

const DIGEST = 'a'.repeat(64)

function release(over: Record<string, unknown> = {}, asset: Record<string, unknown> = {}): unknown {
  return {
    tag_name: 'v0.3.0',
    draft: false,
    prerelease: false,
    published_at: '2026-10-13T09:00:00Z',
    html_url: `${RELEASES_URL}tag/v0.3.0`,
    assets: [
      {
        name: 'bikube-0.3.0.dmg',
        browser_download_url: `${RELEASES_URL}download/v0.3.0/bikube-0.3.0.dmg`,
        size: 10,
        digest: `sha256:${'b'.repeat(64)}`
      },
      {
        name: 'bikube-0.3.0-arm64-mac.zip',
        browser_download_url: `${RELEASES_URL}download/v0.3.0/bikube-0.3.0-arm64-mac.zip`,
        size: 81_474_355,
        digest: `sha256:${DIGEST.toUpperCase()}`,
        ...asset
      }
    ],
    ...over
  }
}

const MAC = { current: '0.2.0', platform: 'darwin', arch: 'arm64' }

describe('versions', () => {
  it('reads x.y.z with or without a v, nothing else', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v0.10.0')).toEqual([0, 10, 0])
    for (const bad of ['1.2', '1.2.3-beta.1', '01.2.3', 'v', '', '1.2.3.4', ' 1.2.3'])
      expect(parseVersion(bad)).toBeNull()
  })

  it('compares numerically, part by part', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.2.1', '0.2.0')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('1.0.0-beta', '0.1.0')).toBe(false)
  })

  it('offers the release to a pre-release build of it or earlier', () => {
    expect(isNewer('0.2.0', '0.2.0-rc.1')).toBe(true)
    expect(isNewer('0.2.1', '0.2.0-beta.2')).toBe(true)
    expect(isNewer('0.1.9', '0.2.0-rc.1')).toBe(false)
    expect(isNewer('0.2.0', '0.2.0-')).toBe(false)
    expect(isNewer('0.2.0', '0.2.0-rc 1')).toBe(false)
  })

  it('names the file each platform installs from', () => {
    expect(assetName('1.0.0', 'darwin', 'arm64')).toBe('bikube-1.0.0-arm64-mac.zip')
    expect(assetName('1.0.0', 'linux', 'x64')).toBe('bikube-1.0.0-x86_64.AppImage')
    expect(assetName('1.0.0', 'darwin', 'x64')).toBeNull()
    expect(assetName('1.0.0', 'win32', 'x64')).toBeNull()
  })
})

describe('the latest release', () => {
  it('gives a newer release with its page and this platform’s file', () => {
    expect(newerRelease(release(), MAC)).toEqual({
      version: '0.3.0',
      publishedAt: '2026-10-13T09:00:00Z',
      pageUrl: `${RELEASES_URL}tag/v0.3.0`,
      asset: {
        name: 'bikube-0.3.0-arm64-mac.zip',
        url: `${RELEASES_URL}download/v0.3.0/bikube-0.3.0-arm64-mac.zip`,
        size: 81_474_355,
        sha256: DIGEST
      },
      waiting: false
    })
  })

  it('waits for this platform’s file while it is missing, uploading or without its checksum', () => {
    const waiting = (asset: Record<string, unknown>): unknown => {
      const r = newerRelease(release({}, asset), MAC)
      return { asset: r?.asset, waiting: r?.waiting }
    }
    expect(waiting({ name: 'something-else.zip' })).toEqual({ asset: null, waiting: true })
    expect(waiting({ state: 'starter' })).toEqual({ asset: null, waiting: true })
    expect(waiting({ digest: null })).toEqual({ asset: null, waiting: true })
    expect(waiting({ digest: undefined })).toEqual({ asset: null, waiting: true })
    expect(waiting({ state: 'uploaded' })).toMatchObject({ waiting: false })
    expect(newerRelease(release({ assets: [] }), MAC)?.waiting).toBe(true)
    // A platform with no file of its own never waits: it can only download from the page.
    expect(newerRelease(release(), { ...MAC, arch: 'x64' })).toMatchObject({
      asset: null,
      waiting: false
    })
  })

  it('ignores the same or an older version, drafts and pre-releases', () => {
    expect(newerRelease(release(), { ...MAC, current: '0.3.0' })).toBeNull()
    expect(newerRelease(release(), { ...MAC, current: '1.0.0' })).toBeNull()
    expect(newerRelease(release({ draft: true }), MAC)).toBeNull()
    expect(newerRelease(release({ prerelease: true }), MAC)).toBeNull()
    expect(newerRelease(release({ tag_name: 'v0.3.0-rc.1' }), MAC)).toBeNull()
    expect(newerRelease(null, MAC)).toBeNull()
    expect(newerRelease('nope', MAC)).toBeNull()
  })

  it('refuses a page outside this repository’s releases', () => {
    expect(newerRelease(release({ html_url: 'https://evil.example/tag/v0.3.0' }), MAC)).toBeNull()
    expect(
      newerRelease(
        release({ html_url: 'https://github.com/someone/bikube/releases/tag/v0.3.0' }),
        MAC
      )
    ).toBeNull()
  })

  it('gives no file when it is missing, elsewhere, unverifiable or too large', () => {
    const fileOf = (asset: Record<string, unknown>): unknown =>
      newerRelease(release({}, asset), MAC)?.asset
    expect(newerRelease(release(), { ...MAC, platform: 'linux', arch: 'x64' })?.asset).toBeNull()
    expect(fileOf({ browser_download_url: 'https://evil.example/bikube.zip' })).toBeNull()
    expect(fileOf({ digest: 'md5:abc' })).toBeNull()
    expect(newerRelease(release({}, { digest: 'md5:abc' }), MAC)?.waiting).toBe(false)
    expect(fileOf({ size: 0 })).toBeNull()
    expect(fileOf({ size: MAX_ASSET_BYTES + 1 })).toBeNull()
  })

  it('takes another base for a test feed', () => {
    const base = 'http://127.0.0.1:4000/'
    const r = newerRelease(
      release({ html_url: `${base}tag/v0.3.0` }, { browser_download_url: `${base}f.zip` }),
      { ...MAC, base }
    )
    expect(r?.asset?.url).toBe(`${base}f.zip`)
  })
})

describe('rechecks of a release whose file isn’t up yet', () => {
  it('stops after the limit, until the user asks', () => {
    const rechecks = new WaitingRechecks(2)
    expect(rechecks.take('0.3.0', false)).toBe(true)
    expect(rechecks.take('0.3.0', false)).toBe(true)
    expect(rechecks.take('0.3.0', false)).toBe(false)
    expect(rechecks.take('0.3.0', true)).toBe(true)
  })

  it('counts per version: one whose file never came leaves the next its own', () => {
    const rechecks = new WaitingRechecks(2)
    rechecks.take('0.3.0', false)
    rechecks.take('0.3.0', false)
    expect(rechecks.take('0.3.0', false)).toBe(false)
    // Found by a background check, not one the user asked for.
    expect(rechecks.take('0.3.1', false)).toBe(true)
    expect(rechecks.take('0.3.1', false)).toBe(true)
    expect(rechecks.take('0.3.1', false)).toBe(false)
  })

  it('allows 30 by default, an hour at 2 minutes', () => {
    const rechecks = new WaitingRechecks()
    for (let i = 0; i < 30; i++) expect(rechecks.take('1.0.0', false)).toBe(true)
    expect(rechecks.take('1.0.0', false)).toBe(false)
  })
})

describe('what an install replaces', () => {
  it('is the .app bundle on macOS, unless macOS runs a translocated copy', () => {
    expect(
      installTarget({
        platform: 'darwin',
        exePath: '/Applications/Bikube.app/Contents/MacOS/Bikube'
      })
    ).toEqual({ kind: 'mac', path: '/Applications/Bikube.app' })
    expect(
      installTarget({
        platform: 'darwin',
        exePath: '/private/var/folders/x/AppTranslocation/ABC/d/Bikube.app/Contents/MacOS/Bikube'
      })
    ).toBeNull()
    expect(
      installTarget({ platform: 'darwin', exePath: '/repo/node_modules/electron/dist/Electron' })
    ).toBeNull()
  })

  it('is the AppImage on Linux, nothing for the .deb', () => {
    expect(
      installTarget({
        platform: 'linux',
        exePath: '/tmp/.mount_x/bikube',
        appImage: '/home/me/Bikube.AppImage'
      })
    ).toEqual({ kind: 'appimage', path: '/home/me/Bikube.AppImage' })
    expect(installTarget({ platform: 'linux', exePath: '/opt/Bikube/bikube' })).toBeNull()
    expect(
      installTarget({ platform: 'linux', exePath: '/x', appImage: 'rel/x.AppImage' })
    ).toBeNull()
  })
})

describe('what an install swaps', () => {
  it('is the bundle’s Contents on macOS, needing only the bundle writable', () => {
    expect(installPaths('mac', '/data/updates/app/Bikube.app', '/Applications/Bikube.app')).toEqual(
      {
        from: '/data/updates/app/Bikube.app/Contents',
        to: '/Applications/Bikube.app/Contents',
        app: '/Applications/Bikube.app',
        writable: ['/Applications/Bikube.app', '/Applications/Bikube.app/Contents']
      }
    )
  })

  it('is the AppImage file, needing its folder writable', () => {
    expect(
      installPaths('appimage', '/data/updates/new.AppImage', '/home/me/Bikube.AppImage')
    ).toEqual({
      from: '/data/updates/new.AppImage',
      to: '/home/me/Bikube.AppImage',
      app: '/home/me/Bikube.AppImage',
      writable: ['/home/me', '/home/me/Bikube.AppImage']
    })
    expect(installPaths('appimage', '/n', '/Bikube.AppImage').writable[0]).toBe('/')
  })
})

describe('the install script', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bikube-update-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  /** A pid that has already exited. */
  const gonePid = (): number => spawnSync('true').pid!

  const failed = (): string => join(dir, 'install-failed')
  const install = (pid: number, from: string, to: string): Promise<number> =>
    new Promise((resolve) => {
      const args = ['-c', INSTALL_SCRIPT, 'sh', String(pid), from, to, 'none', failed(), to]
      const child = spawn('/bin/sh', args)
      child.on('exit', (code) => resolve(code ?? -1))
    })

  it('swaps a bundle’s Contents in a folder the user can’t write, as /Applications for a standard account', async () => {
    const apps = join(dir, 'Applications')
    mkdirSync(join(apps, 'Bikube.app/Contents'), { recursive: true })
    writeFileSync(join(apps, 'Bikube.app/Contents/v'), 'old')
    mkdirSync(join(dir, 'new/Bikube.app/Contents'), { recursive: true })
    writeFileSync(join(dir, 'new/Bikube.app/Contents/v'), 'new')
    const { from, to } = installPaths('mac', join(dir, 'new/Bikube.app'), join(apps, 'Bikube.app'))
    chmodSync(apps, 0o555)
    try {
      expect(await install(gonePid(), from, to)).toBe(0)
    } finally {
      chmodSync(apps, 0o755)
    }
    expect(readFileSync(join(apps, 'Bikube.app/Contents/v'), 'utf8')).toBe('new')
    expect(readdirSync(join(apps, 'Bikube.app'))).toEqual(['Contents'])
    expect(readdirSync(join(dir, 'new/Bikube.app'))).toEqual([])
    expect(existsSync(failed())).toBe(false)
  })

  it('swaps a file, in a path with spaces', async () => {
    const target = join(dir, 'my apps', 'Bikube.AppImage')
    mkdirSync(join(dir, 'my apps'))
    writeFileSync(target, 'old')
    writeFileSync(join(dir, 'next'), 'new')
    expect(await install(gonePid(), join(dir, 'next'), target)).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('new')
    expect(readdirSync(join(dir, 'my apps'))).toEqual(['Bikube.AppImage'])
  })

  it('waits for the process to end before touching anything', async () => {
    const target = join(dir, 'Bikube.AppImage')
    writeFileSync(target, 'old')
    writeFileSync(join(dir, 'next'), 'new')
    const app = spawn('sleep', ['1'])
    const done = install(app.pid!, join(dir, 'next'), target)
    await new Promise((r) => setTimeout(r, 400))
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(await done).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('new')
  })

  it('keeps the old app when the new one is missing, and says why', async () => {
    const target = join(dir, 'Bikube.AppImage')
    writeFileSync(target, 'old')
    expect(await install(gonePid(), join(dir, 'missing'), target)).toBe(1)
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(readdirSync(dir).sort()).toEqual(['Bikube.AppImage', 'install-failed'])
    expect(readFileSync(failed(), 'utf8')).toContain('missing')
  })

  it('keeps the old app when its folder can’t be written, and says why', async () => {
    const apps = join(dir, 'apps')
    mkdirSync(apps)
    writeFileSync(join(apps, 'Bikube.AppImage'), 'old')
    writeFileSync(join(dir, 'next'), 'new')
    chmodSync(apps, 0o555)
    try {
      expect(await install(gonePid(), join(dir, 'next'), join(apps, 'Bikube.AppImage'))).toBe(1)
    } finally {
      chmodSync(apps, 0o755)
    }
    expect(readFileSync(join(apps, 'Bikube.AppImage'), 'utf8')).toBe('old')
    expect(readFileSync(failed(), 'utf8')).toMatch(/denied/i)
  })
})

describe('the popup’s words', () => {
  it('formats sizes', () => {
    expect(formatSize(81_474_355)).toBe('77.7 MB')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(10)).toBe('1 KB')
  })

  it('names the terminals an install stops', () => {
    expect(installMessage(0)).toBe('Bikube quits, installs the update and opens again.')
    expect(installMessage(1)).toBe(
      'Bikube quits, installs the update and opens again. 1 terminal is running and will be stopped.'
    )
    expect(installMessage(3)).toContain('3 terminals are running')
  })
})
