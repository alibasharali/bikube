import { describe, expect, it } from 'vitest'
import {
  checkHost,
  checkRemoteDirectory,
  HOST_INVALID,
  REMOTE_DIRECTORY_INVALID
} from './ssh-location'

describe('checkHost (D2)', () => {
  it('accepts hosts as ssh takes them, trimmed', () => {
    for (const host of [
      'devbox',
      'me@devbox',
      'build.example.com',
      'ssh://me@devbox:2222',
      'me@[fe80::1%eth0]',
      'my_alias-2'
    ]) {
      expect(checkHost(` ${host} `)).toEqual({ ok: true, value: host })
    }
  })

  it('requires a host', () => {
    for (const host of ['', '   ']) {
      expect(checkHost(host)).toEqual({ ok: false, message: 'Host is required' })
    }
  })

  it('rejects a leading -, other characters and over 255 characters', () => {
    expect(HOST_INVALID).toBe('Enter a host as ssh takes it, e.g. me@devbox')
    for (const host of [
      '-oProxyCommand=x',
      '-x',
      'me@dev box',
      'dev;rm',
      'dev$x',
      'dév',
      "dev'x",
      'dev\nbox',
      'a'.repeat(256)
    ]) {
      expect(checkHost(host)).toEqual({ ok: false, message: HOST_INVALID })
    }
    expect(checkHost('a'.repeat(255)).ok).toBe(true)
  })
})

describe('checkRemoteDirectory (D3)', () => {
  it('accepts absolute paths, ~ and ~/…, trimmed', () => {
    for (const dir of ['/tmp/bikube-remote', '/', '~', '~/src/api', '/nope/with space']) {
      expect(checkRemoteDirectory(` ${dir} `)).toEqual({ ok: true, value: dir })
    }
  })

  it('requires a directory', () => {
    for (const dir of ['', '  ']) {
      expect(checkRemoteDirectory(dir)).toEqual({
        ok: false,
        message: 'Working directory is required'
      })
    }
  })

  it('rejects relative paths, ~user, control characters and over 4096 characters', () => {
    expect(REMOTE_DIRECTORY_INVALID).toBe('Enter an absolute path or one starting with ~')
    for (const dir of [
      'relative/dir',
      '~other',
      'C:\\x',
      '/tmp/a\nb',
      '/tmp/\u0007',
      '/tmp/\u007f',
      '/' + 'a'.repeat(4096)
    ]) {
      expect(checkRemoteDirectory(dir)).toEqual({ ok: false, message: REMOTE_DIRECTORY_INVALID })
    }
    expect(checkRemoteDirectory('/' + 'a'.repeat(4095)).ok).toBe(true)
  })

  it('rejects C1 control characters (U+0080–U+009F) but accepts U+00A0 and above', () => {
    for (const dir of ['/srv/a\u009b2Jb', '/srv/\u0080', '/srv/\u009f']) {
      expect(checkRemoteDirectory(dir)).toEqual({ ok: false, message: REMOTE_DIRECTORY_INVALID })
    }
    expect(checkRemoteDirectory('/srv/\u00a0é').ok).toBe(true)
  })

  it('rejects backslashes, which a fish login shell reads as escapes in the SSH line', () => {
    for (const dir of ['/a\\', "/x\\'; touch /tmp/pwned; #", '~/a\\\\b']) {
      expect(checkRemoteDirectory(dir)).toEqual({ ok: false, message: REMOTE_DIRECTORY_INVALID })
    }
  })
})
