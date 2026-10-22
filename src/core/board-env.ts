/**
 * The variables every card's shell gets so `board` works inside it (#9 D3, D4). Plain TS: main
 * passes the paths it resolved for dev or the packaged app.
 */
import { CLAUDE_SETTINGS_FILE } from './claude-hooks'

export interface BoardEnvInput {
  /** The card the shell runs for. */
  cardId: string
  /** Absolute path of main's `board/board.sock`. */
  socketPath: string
  /** Bikube's bin directory, holding the `board` wrapper. */
  binDir: string
  /** Bikube's own executable, which the wrapper runs as Node. */
  executable: string
  /** The bundled CLI module the wrapper runs. */
  cliPath: string
  /** The inherited PATH, if any. */
  path: string | undefined
}

/**
 * `BIKUBE_CARD_ID`, `BIKUBE_SOCKET`, `BIKUBE_BIN` and PATH with the bin directory first (#9 D3):
 * a login shell's profile may reorder PATH, `"$BIKUBE_BIN/board"` works regardless. Plus the
 * executable and module the wrapper needs (#9 D4). `ELECTRON_RUN_AS_NODE` is set only inside
 * the wrapper: in the shell it would turn every Electron app the card starts into Node.
 * `BIKUBE_CLAUDE_SETTINGS` names the Claude settings file beside `board`, which a Claude Code
 * card's start line passes to `claude --settings` (#31 D14).
 */
export function boardShellEnv(input: BoardEnvInput): Record<string, string> {
  return {
    BIKUBE_CARD_ID: input.cardId,
    BIKUBE_SOCKET: input.socketPath,
    BIKUBE_BIN: input.binDir,
    BIKUBE_EXECUTABLE: input.executable,
    BIKUBE_BOARD_CLI: input.cliPath,
    BIKUBE_CLAUDE_SETTINGS: `${input.binDir}/${CLAUDE_SETTINGS_FILE}`,
    PATH: input.path ? `${input.binDir}:${input.path}` : input.binDir
  }
}
