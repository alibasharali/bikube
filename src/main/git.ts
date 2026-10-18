import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  aheadBehind,
  createBranch,
  fetchAll,
  gitIn,
  inRepository,
  listBranches,
  pull,
  push,
  switchBranch,
  trackBranch,
  type AheadBehind,
  type BranchList,
  type NewBranchResult,
  type GitResult,
  type GitRunner,
  type SyncResult
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

/** What a request for a folder that isn't an existing one inside a git work tree gets. */
const NO_REPOSITORY: { ok: false; reason: string } = { ok: false, reason: 'not a git repository' }

/**
 * The title bar's branch menu (#33): lists, switches and creates branches of a local folder's
 * repository, fetches, pulls and pushes it.
 * Only an absolute existing folder inside a git work tree is used (asked before any other git
 * command runs there), names are checked against git's own lists before they
 * are passed (as single arguments) and requests come from the main frame only (D15).
 */
export function registerGit(): void {
  const git = gitIn(runner, process.env)
  const guard = (event: IpcMainInvokeEvent, channel: string): void => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
      throw new Error(`${channel} rejected: untrusted sender`)
    }
  }
  /** `dir` when it is an absolute existing folder inside a git work tree (D15), else null. */
  const repository = async (dir: unknown): Promise<string | null> => {
    const at = await folder(dir)
    return at && (await inRepository(at, git)) ? at : null
  }

  ipcMain.handle(IPC.gitBranches, async (event, dir: unknown): Promise<BranchList | null> => {
    guard(event, IPC.gitBranches)
    const at = await repository(dir)
    return at ? listBranches(at, git) : null
  })
  ipcMain.handle(
    IPC.gitSwitch,
    async (event, dir: unknown, branch: unknown): Promise<GitResult> => {
      guard(event, IPC.gitSwitch)
      const at = await repository(dir)
      if (!at) return NO_REPOSITORY
      if (typeof branch !== 'string') return { ok: false, reason: 'Not a valid branch name' }
      return switchBranch(at, branch, git)
    }
  )
  ipcMain.handle(
    IPC.gitTrack,
    async (event, dir: unknown, remote: unknown, branch: unknown): Promise<GitResult> => {
      guard(event, IPC.gitTrack)
      const at = await repository(dir)
      if (!at) return NO_REPOSITORY
      if (typeof remote !== 'string' || typeof branch !== 'string') {
        return { ok: false, reason: 'Not a valid branch name' }
      }
      return trackBranch(at, remote, branch, git)
    }
  )
  ipcMain.handle(
    IPC.gitCreate,
    async (event, dir: unknown, name: unknown): Promise<NewBranchResult> => {
      guard(event, IPC.gitCreate)
      const at = await repository(dir)
      if (!at) return NO_REPOSITORY
      if (typeof name !== 'string')
        return { ok: false, reason: 'Not a valid branch name', name: true }
      return createBranch(at, name, git)
    }
  )
  ipcMain.handle(IPC.gitAheadBehind, async (event, dir: unknown): Promise<AheadBehind | null> => {
    guard(event, IPC.gitAheadBehind)
    const at = await repository(dir)
    return at ? aheadBehind(at, git) : null
  })
  const sync = (channel: string, command: typeof fetchAll): void => {
    ipcMain.handle(channel, async (event, dir: unknown): Promise<SyncResult> => {
      guard(event, channel)
      const at = await repository(dir)
      return at ? command(at, git) : NO_REPOSITORY
    })
  }
  sync(IPC.gitFetch, fetchAll)
  sync(IPC.gitPull, pull)
  sync(IPC.gitPush, push)
}
