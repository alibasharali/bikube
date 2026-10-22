import { describe, expect, it } from 'vitest'
import { shellIntegrationStart } from './shell-integration'

const scriptsDir = '/app/resources/shell-integration'
const on = { enabled: true, scriptsDir, env: {} }

describe('shellIntegrationStart (#45 D3, D4, AC3)', () => {
  it("starts zsh with -l and Bikube's ZDOTDIR, keeping the user's in BIKUBE_ZDOTDIR", () => {
    expect(
      shellIntegrationStart('/bin/zsh', { ...on, env: { ZDOTDIR: '/home/me/.config/zsh' } })
    ).toEqual({
      args: ['-l'],
      env: { ZDOTDIR: `${scriptsDir}/zsh`, BIKUBE_ZDOTDIR: '/home/me/.config/zsh' }
    })
  })

  it('adds no BIKUBE_ZDOTDIR when the user has no ZDOTDIR, so the script unsets it', () => {
    expect(shellIntegrationStart('/opt/homebrew/bin/zsh', on)).toEqual({
      args: ['-l'],
      env: { ZDOTDIR: `${scriptsDir}/zsh` }
    })
  })

  it("starts bash with --init-file and Bikube's script instead of -l", () => {
    expect(shellIntegrationStart('/usr/bin/bash', on)).toEqual({
      args: ['--init-file', `${scriptsDir}/bash/bikube.bash`],
      env: {}
    })
  })

  it("puts Bikube's folder first in fish's XDG_DATA_DIRS and keeps the old value", () => {
    expect(
      shellIntegrationStart('/usr/bin/fish', {
        ...on,
        env: { XDG_DATA_DIRS: '/usr/share/gnome:/usr/share' }
      })
    ).toEqual({
      args: ['-l'],
      env: {
        XDG_DATA_DIRS: `${scriptsDir}:/usr/share/gnome:/usr/share`,
        BIKUBE_XDG_DATA_DIRS: '/usr/share/gnome:/usr/share'
      }
    })
  })

  it("gives fish the XDG defaults after Bikube's folder when XDG_DATA_DIRS was unset", () => {
    for (const env of [{}, { XDG_DATA_DIRS: '' }]) {
      expect(shellIntegrationStart('/usr/local/bin/fish', { ...on, env })).toEqual({
        args: ['-l'],
        env: {
          XDG_DATA_DIRS: `${scriptsDir}:/usr/local/share:/usr/share`,
          BIKUBE_XDG_DATA_DIRS: ''
        }
      })
    }
  })

  it('starts any other shell, or a name that only contains one, exactly as before', () => {
    for (const shell of ['/bin/sh', '/bin/dash', '/usr/bin/nu', '/bin/tcsh', '/opt/zsh-5/zshx']) {
      expect(shellIntegrationStart(shell, on)).toEqual({ args: ['-l'], env: {} })
    }
  })

  it("starts an SSH card's local shell, which only runs `ssh`, exactly as before", () => {
    for (const shell of ['/bin/zsh', '/bin/bash', '/usr/bin/fish']) {
      expect(
        shellIntegrationStart(shell, {
          ...on,
          command: 'exec ssh -t -- host',
          env: { ZDOTDIR: '/z' }
        })
      ).toEqual({ args: ['-l'], env: {} })
    }
  })

  it('starts zsh, bash and fish as before with the setting off', () => {
    for (const shell of ['/bin/zsh', '/bin/bash', '/usr/bin/fish']) {
      expect(
        shellIntegrationStart(shell, { ...on, enabled: false, env: { ZDOTDIR: '/z' } })
      ).toEqual({ args: ['-l'], env: {} })
    }
  })
})
