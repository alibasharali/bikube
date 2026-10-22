import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  createWorktree,
  removeWorktree,
  repoInfo,
  worktreeDirty,
  type Run,
  type WorktreeFs
} from '../core/worktrees'
import { IPC, type WorktreeInfo } from '../shared/api'

/** Commands run without a shell, with room for a big ignored-files listing. */
const run: Run = (command, args, cwd) =>
  new Promise((done) => {
    execFile(
      command,
      args,
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        done({ code, stdout, stderr })
      }
    )
  })

const fs: WorktreeFs = {
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  mkdirp: async (path) => {
    await mkdir(path, { recursive: true })
  }
}

const isDirectoryPath = async (value: unknown): Promise<boolean> => {
  if (typeof value !== 'string' || !isAbsolute(value)) return false
  try {
    return (await stat(value)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Git worktrees for cards, kept in `<userData>/worktrees`: what a folder's repository is, making a
 * worktree for a new card, whether one has uncommitted changes, and removing one. Only paths
 * inside that folder are ever checked or removed.
 */
export function registerWorktrees(): void {
  const root = join(app.getPath('userData'), 'worktrees')
  const inside = (path: unknown): path is string => {
    if (typeof path !== 'string' || !isAbsolute(path)) return false
    const rel = relative(root, resolve(path))
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
  const fromMainFrame = (event: IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  const guard = (event: IpcMainInvokeEvent, channel: string): void => {
    if (!fromMainFrame(event)) throw new Error(`${channel} rejected: untrusted sender`)
  }

  ipcMain.handle(IPC.worktreeInfo, async (event, dir: unknown): Promise<WorktreeInfo | null> => {
    guard(event, IPC.worktreeInfo)
    if (!(await isDirectoryPath(dir))) return null
    const repo = await repoInfo(dir as string, run)
    return repo && { branch: repo.branch, branches: repo.branches }
  })
  ipcMain.handle(IPC.worktreeCreate, async (event, dir: unknown, branch: unknown) => {
    guard(event, IPC.worktreeCreate)
    if (!(await isDirectoryPath(dir))) return { ok: false, reason: 'working directory not found' }
    if (typeof branch !== 'string') return { ok: false, reason: 'Not a valid branch name' }
    return createWorktree(
      { dir: dir as string, branch, worktreesRoot: root, platform: process.platform },
      run,
      fs
    )
  })
  ipcMain.handle(IPC.worktreeDirty, async (event, path: unknown) => {
    guard(event, IPC.worktreeDirty)
    return inside(path) ? worktreeDirty(path, run) : null
  })
  ipcMain.handle(
    IPC.worktreeRemove,
    async (event, repo: unknown, path: unknown, force: unknown) => {
      guard(event, IPC.worktreeRemove)
      if (!inside(path) || !(await isDirectoryPath(repo))) {
        return { ok: false, reason: 'not a Bikube worktree' }
      }
      return removeWorktree(repo as string, path, force === true, run, fs)
    }
  )
}
