import { app, ipcMain, type WebContents } from 'electron'
import { dirname, join } from 'node:path'
import { boardShellEnv } from '../core/board-env'
import { CLAUDE_SETTINGS_FILE } from '../core/claude-hooks'
import { BoardRelay } from '../core/board-relay'
import { NO_ANSWER } from '../core/board-protocol'
import { startBoardServer, type BoardHandler, type BoardServer } from '../core/board-server'
import {
  orchestratorSockets,
  removeLeftoverSessionSockets,
  SessionSockets,
  sharedSocketHandler
} from '../core/session-sockets'
import { IPC } from '../shared/api'
import type { Terminals } from './terminals'

/**
 * `<userData>/board/board.sock` (#9 D5), in a private directory the server creates;
 * `BIKUBE_USER_DATA_DIR` gives each test its own.
 */
export function boardSocketPath(): string {
  return join(app.getPath('userData'), 'board', 'board.sock')
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

/**
 * Bikube's own Claude Code settings file (#31 D14), beside `board`: the file every local Claude
 * Code card gets as `BIKUBE_CLAUDE_SETTINGS`, whose hooks Agent setup lists (#68 D8).
 */
export function claudeSettingsPath(): string {
  return join(boardPaths().binDir, CLAUDE_SETTINGS_FILE)
}

/**
 * The SSH sessions' sockets (#25 D2) and the Orchestrator sessions' (#81 D16), next to
 * `board.sock` in its private directory. They serve once `registerBoard` hands them its relay;
 * none exists before then.
 */
export function sessionBoardSockets(socketPath: string): {
  ssh: SessionSockets
  orchestrator: SessionSockets
  relayTo(handler: BoardHandler): void
} {
  let relay: BoardHandler = async () => ({ ok: false, error: NO_ANSWER })
  const relayed: BoardHandler = (request) => relay(request)
  return {
    ssh: new SessionSockets(dirname(socketPath), relayed),
    orchestrator: orchestratorSockets(dirname(socketPath), relayed),
    relayTo: (handler) => {
      relay = handler
    }
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
 * without it. `board.sock` refuses the orchestrator-only commands and any request naming an
 * Orchestrator (#81 D16). The SSH and Orchestrator sessions' sockets relay the same way (#25 D2,
 * #81 D16); a previous run's leftovers are removed first. Returns the function that closes every
 * socket on quit.
 */
export function registerBoard(
  socketPath: string,
  terminals: Terminals,
  sessions: ReturnType<typeof sessionBoardSockets>
): () => void {
  const relay = new BoardRelay<WebContents>(
    (cardId) => terminals.ownerOfCard(cardId),
    (owner, requestId, cardId, command) => {
      owner.send(IPC.boardRequest, requestId, cardId, command)
    },
    undefined,
    // A client that left before its answer (an interrupted `board wait`, #81 D20): the page drops
    // what the request waits on.
    (owner, requestId) => {
      if (!owner.isDestroyed()) owner.send(IPC.boardCancel, requestId)
    }
  )
  terminals.onWindowGone((owner) => relay.release(owner))
  // A reload or crash releases the old page's requests at once (#9 D9).
  terminals.onPageGone((owner) => relay.releasePage(owner))

  // Only a window's own top-level page answers, and only for a request sent to that window.
  ipcMain.on(IPC.boardAnswer, (event, requestId: unknown, reply: unknown) => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) return
    relay.answer(event.sender, requestId, reply)
  })

  removeLeftoverSessionSockets(dirname(socketPath))
  sessions.relayTo((request) => relay.handle(request))

  let server: BoardServer | null = null
  let closed = false
  startBoardServer(
    socketPath,
    sharedSocketHandler((request) => relay.handle(request))
  ).then(
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
    sessions.ssh.closeAll()
    sessions.orchestrator.closeAll()
    void server?.close()
    server = null
  }
}
