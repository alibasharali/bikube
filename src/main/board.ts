import { app, ipcMain, type WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { boardShellEnv } from '../core/board-env'
import { BoardRelay } from '../core/board-relay'
import { startBoardServer, type BoardServer } from '../core/board-server'
import { IPC } from '../shared/api'
import type { Terminals } from './terminals'

/** `<userData>/board.sock` (#9 D5); `DROVR_USER_DATA_DIR` gives each test its own. */
export function boardSocketPath(): string {
  return join(app.getPath('userData'), 'board.sock')
}

/**
 * Where the `board` wrapper and the CLI module are (#9 D4). Packaged, both are real files
 * outside the asar archive: the bin directory is copied to `resources/bin` and the module is
 * unpacked next to the archive (electron-builder.yml).
 */
function boardPaths(): { binDir: string; cliPath: string } {
  const cliPath = join(__dirname, 'board-cli.js')
  if (!app.isPackaged) {
    return { binDir: join(app.getAppPath(), 'resources', 'bin'), cliPath }
  }
  return {
    binDir: join(process.resourcesPath, 'bin'),
    cliPath: cliPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  }
}

/** The variables each card's shell gets so `board` works in it (#9 D3). */
export function boardShellEnvFor(socketPath: string): (cardId: string) => Record<string, string> {
  const { binDir, cliPath } = boardPaths()
  return (cardId) =>
    boardShellEnv({
      cardId,
      socketPath,
      binDir,
      cliPath,
      executable: process.execPath,
      path: process.env['PATH']
    })
}

/**
 * Serves `board` on the socket (#9 D5, D6, D10): each request goes to the window owning the
 * calling card's session, whose answer is relayed back. When listening fails the app runs on
 * without it. Returns the function that closes the socket on quit.
 */
export function registerBoard(socketPath: string, terminals: Terminals): () => void {
  const relay = new BoardRelay<WebContents>(
    (cardId) => terminals.ownerOfCard(cardId),
    (owner, requestId, cardId, command) => {
      owner.send(IPC.boardRequest, requestId, cardId, command)
    }
  )
  terminals.onWindowGone((owner) => relay.release(owner))

  // Only a window's own top-level page answers, and only for a request sent to that window.
  ipcMain.on(IPC.boardAnswer, (event, requestId: unknown, reply: unknown) => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) return
    relay.answer(event.sender, requestId, reply)
  })

  let server: BoardServer | null = null
  let closed = false
  try {
    mkdirSync(dirname(socketPath), { recursive: true })
  } catch {
    // Listening below fails and says why.
  }
  startBoardServer(socketPath, (request) => relay.handle(request)).then(
    (started) => {
      if (closed) void started.close()
      else server = started
    },
    (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`board: not listening on ${socketPath}: ${reason}`)
    }
  )
  return () => {
    closed = true
    void server?.close()
    server = null
  }
}
