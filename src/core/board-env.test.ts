import { describe, expect, it } from 'vitest'
import { boardShellEnv } from './board-env'

const paths = {
  socketPath: '/data/board.sock',
  binDir: '/app/bin',
  executable: '/app/Bikube',
  cliPath: '/app/out/main/board-cli.js'
}

describe('boardShellEnv', () => {
  it("gives the shell the card's id, the socket and Bikube's bin directory first on PATH (#9 D3)", () => {
    const env = boardShellEnv({ ...paths, cardId: 'c1', path: '/usr/bin:/bin' })
    expect(env).toMatchObject({
      BIKUBE_CARD_ID: 'c1',
      BIKUBE_SOCKET: '/data/board.sock',
      PATH: '/app/bin:/usr/bin:/bin'
    })
  })

  it("tells the wrapper Bikube's executable and CLI module, never ELECTRON_RUN_AS_NODE (#9 D4)", () => {
    const env = boardShellEnv({ ...paths, cardId: 'c1', path: '/bin' })
    expect(env.BIKUBE_EXECUTABLE).toBe('/app/Bikube')
    expect(env.BIKUBE_BOARD_CLI).toBe('/app/out/main/board-cli.js')
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it('names the bin directory in BIKUBE_BIN, for calling board whatever PATH says (#9 D3)', () => {
    expect(boardShellEnv({ ...paths, cardId: 'c1', path: '/bin' }).BIKUBE_BIN).toBe('/app/bin')
  })

  it('makes the bin directory the whole PATH when there was none', () => {
    expect(boardShellEnv({ ...paths, cardId: 'c1', path: undefined }).PATH).toBe('/app/bin')
    expect(boardShellEnv({ ...paths, cardId: 'c1', path: '' }).PATH).toBe('/app/bin')
  })

  it("names Bikube's Claude settings file in the bin directory (#31 D14)", () => {
    expect(boardShellEnv({ ...paths, cardId: 'c1', path: '/bin' }).BIKUBE_CLAUDE_SETTINGS).toBe(
      '/app/bin/claude-settings.json'
    )
  })
})
