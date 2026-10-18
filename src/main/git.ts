import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  gitIn,
  listBranches,
  switchBranch,
  trackBranch,
  type BranchList,
  type GitResult,
  type GitRunner
} from '../core/git'
import { IPC } from '../shared/api'

/** git without a shell, stdin closed, killed at the call's time limit (D12). */
const runner: GitRunner = ({ args, cwd, env, timeoutMs }) =>
  new Promise((done) => {
    const child = execFile(
      'git',
      args,
      { cwd, env, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const timedOut = error !== null && error.killed === true
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        done({ code, stdout, stderr, timedOut })
      }
    )
    child.stdin?.end()
  })

/** `value` when it is an absolute path to an existing folder, else null. */
const folder = async (value: unknown): Promise<string | null> => {
  if (typeof value !== 'string' || !isAbsolute(value)) return null
  try {
    return (await stat(value)).isDirectory() ? value : null
  } catch {
    return null
  }
}

const NO_FOLDER: GitResult = { ok: false, reason: 'working directory not found' }

/**
 * The title bar's branch menu (#33): lists and switches branches of a local folder's repository.
 * Only an absolute existing folder is used, names are checked against git's own lists before they
 * are passed (as single arguments) and requests come from the main frame only (D15).
 */
export function registerGit(): void {
  const git = gitIn(runner, process.env)
  const guard = (event: IpcMainInvokeEvent, channel: string): void => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
      throw new Error(`${channel} rejected: untrusted sender`)
    }
  }

  ipcMain.handle(IPC.gitBranches, async (event, dir: unknown): Promise<BranchList | null> => {
    guard(event, IPC.gitBranches)
    const at = await folder(dir)
    return at ? listBranches(at, git) : null
  })
  ipcMain.handle(
    IPC.gitSwitch,
    async (event, dir: unknown, branch: unknown): Promise<GitResult> => {
      guard(event, IPC.gitSwitch)
      const at = await folder(dir)
      if (!at) return NO_FOLDER
      if (typeof branch !== 'string') return { ok: false, reason: 'Not a valid branch name' }
      return switchBranch(at, branch, git)
    }
  )
  ipcMain.handle(
    IPC.gitTrack,
    async (event, dir: unknown, remote: unknown, branch: unknown): Promise<GitResult> => {
      guard(event, IPC.gitTrack)
      const at = await folder(dir)
      if (!at) return NO_FOLDER
      if (typeof remote !== 'string' || typeof branch !== 'string') {
        return { ok: false, reason: 'Not a valid branch name' }
      }
      return trackBranch(at, remote, branch, git)
    }
  )
}
