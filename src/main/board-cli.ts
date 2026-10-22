/**
 * The `board` command's entry (#9 D4): the `board` wrapper runs this module with Bikube's own
 * executable as Node (`ELECTRON_RUN_AS_NODE=1`). Built next to main's bundle as `board-cli.js`;
 * it imports no Electron module.
 */
import { runBoard } from '../core/board-client'

void runBoard(process.argv.slice(2), process.env, {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
}).then((code) => {
  process.exitCode = code
})
