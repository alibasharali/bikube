/**
 * The variables every card's shell gets so `board` works inside it (#9 D3, D4). Plain TS: main
 * passes the paths it resolved for dev or the packaged app.
 */

export interface BoardEnvInput {
  /** The card the shell runs for. */
  cardId: string
  /** Absolute path of main's `board/board.sock`. */
  socketPath: string
  /** Drovr's bin directory, holding the `board` wrapper. */
  binDir: string
  /** Drovr's own executable, which the wrapper runs as Node. */
  executable: string
  /** The bundled CLI module the wrapper runs. */
  cliPath: string
  /** The inherited PATH, if any. */
  path: string | undefined
}

/**
 * `DROVR_CARD_ID`, `DROVR_SOCKET`, `DROVR_BIN` and PATH with the bin directory first (#9 D3):
 * a login shell's profile may reorder PATH, `"$DROVR_BIN/board"` works regardless. Plus the
 * executable and module the wrapper needs (#9 D4). `ELECTRON_RUN_AS_NODE` is set only inside
 * the wrapper: in the shell it would turn every Electron app the card starts into Node.
 */
export function boardShellEnv(input: BoardEnvInput): Record<string, string> {
  return {
    DROVR_CARD_ID: input.cardId,
    DROVR_SOCKET: input.socketPath,
    DROVR_BIN: input.binDir,
    DROVR_EXECUTABLE: input.executable,
    DROVR_BOARD_CLI: input.cliPath,
    PATH: input.path ? `${input.binDir}:${input.path}` : input.binDir
  }
}
