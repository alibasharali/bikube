/**
 * Opening a file from the side panel's Files tab (#55 D13–D16). Plain TS: main injects the
 * process spawner and Electron's `shell.openPath`, so Vitest runs real shells on temp folders.
 *
 * VS Code, Cursor, Zed and custom commands run through the user's login shell (`-l -c`) so they
 * get the PATH the user's cards have (D15). The paths are positional arguments, never pasted into
 * the command text; a custom command's text is the only text the shell parses. POSIX shells
 * (sh, bash, zsh, dash, ksh…) get `"$@"`/`"$1"`; fish, which has no `$@`, gets its own syntax
 * with `$argv`; any other shell (nu, pwsh, elvish, xonsh…) is replaced by `/bin/sh -l`, whose
 * profile still sets the user's PATH.
 */

import type { spawn as nodeSpawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDirectory } from './directories'
import { insideFolder } from './file-tree'
import type { OpenResult } from './open-result'
import type { Editor } from './settings'

export type { OpenResult }

/** The command each named editor's CLI is (D13). */
const EDITOR_COMMANDS: Record<'vscode' | 'cursor' | 'zed', string> = {
  vscode: 'code',
  cursor: 'cursor',
  zed: 'zed'
}

/** Shells that take POSIX `sh -c 'text' $0 $1…`. */
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'oksh', 'yash', 'ash'])

/** The `$0` a POSIX shell is given, shown in its own error messages. */
const ARG0 = 'bikube'

/** How an open runs: a login shell command, the OS's default app, or nothing (no custom command). */
export type EditorPlan =
  | {
      kind: 'run'
      /** The command name a "not found" reason names: the editor's CLI, a custom command's first word. */
      name: string
      command: string
      args: string[]
    }
  | { kind: 'system' }
  | { kind: 'no-command' }

/** The login shell editors run through (D15): the Shell setting, else `$SHELL`, else `/bin/sh`. */
export function editorShell(setting: string, env: Record<string, string | undefined>): string {
  return setting !== '' ? setting : env['SHELL'] || '/bin/sh'
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/**
 * How `editor` (with `editorCommand` for `custom`) opens the absolute `file`, VS Code, Cursor and
 * Zed with the shown `folder` as the project (D13), under the login shell `shell` (D15).
 */
export function editorPlan(
  editor: Editor,
  editorCommand: string,
  shell: string,
  folder: string,
  file: string
): EditorPlan {
  if (editor === 'system') return { kind: 'system' }
  const custom = editorCommand.trim()
  if (editor === 'custom' && custom === '') return { kind: 'no-command' }
  const flavour = baseName(shell)
  const fish = flavour === 'fish'
  const command = fish || POSIX_SHELLS.has(flavour) ? shell : '/bin/sh'
  if (editor === 'custom') {
    const name = custom.split(/\s+/)[0]!
    return fish
      ? { kind: 'run', name, command, args: ['-l', '-c', `${custom} $argv[1]`, file] }
      : { kind: 'run', name, command, args: ['-l', '-c', `${custom} "$1"`, ARG0, file] }
  }
  const name = EDITOR_COMMANDS[editor]
  return fish
    ? {
        kind: 'run',
        name,
        command,
        args: ['-l', '-c', 'command -q $argv[1]; or exit 127; exec $argv', name, folder, file]
      }
    : {
        kind: 'run',
        name,
        command,
        args: [
          '-l',
          '-c',
          'command -v "$1" >/dev/null 2>&1 || exit 127; exec "$@"',
          ARG0,
          name,
          folder,
          file
        ]
      }
}

/** How long an editor may take to fail before it is taken as started (D13): a CLI like `code` returns at once; `subl --wait` never does. */
export const EDITOR_WAIT_MS = 4000

/** The longest error reason kept from an editor's stderr. */
const REASON_MAX = 300

export type EditorRun = { ok: true } | { ok: false; reason: string }

export interface RunDeps {
  spawn: typeof nodeSpawn
  env: Record<string, string>
  /** The folder the shell starts in. */
  cwd: string
  /** `EDITOR_WAIT_MS` unless given. */
  waitMs?: number
}

/**
 * Starts `plan`'s login shell detached, stdin closed, stdout dropped and stderr kept only for the
 * reason (D15). It is ok once it exits 0 or is still running after the wait (then it is let go);
 * a non-zero exit within the wait gives its reason: `<name> not found` for 127, else the last
 * line it wrote to stderr, else its exit code.
 */
export function runEditor(
  plan: Extract<EditorPlan, { kind: 'run' }>,
  { spawn, env, cwd, waitMs = EDITOR_WAIT_MS }: RunDeps
): Promise<EditorRun> {
  return new Promise((done) => {
    let settled = false
    const finish = (result: EditorRun): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(result)
    }
    let child: ReturnType<typeof nodeSpawn>
    try {
      child = spawn(plan.command, plan.args, {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      done({ ok: false, reason: spawnReason(plan.command, err) })
      return
    }
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (!settled) stderr = (stderr + chunk).slice(-16 * 1024)
    })
    const timer = setTimeout(() => {
      // Still running: started. It lives on its own; the app neither waits for it nor its output.
      finish({ ok: true })
      child.unref()
      ;(child.stderr as { unref?: () => void } | null)?.unref?.()
    }, waitMs)
    child.on('error', (err) => finish({ ok: false, reason: spawnReason(plan.command, err) }))
    const failed = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (code === 127) return finish({ ok: false, reason: `${plan.name} not found` })
      const last = stderr
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .pop()
      const reason =
        last !== undefined
          ? last.slice(-REASON_MAX)
          : code !== null
            ? `exited with code ${code}`
            : `stopped by ${signal ?? 'a signal'}`
      finish({ ok: false, reason })
    }
    // `exit`, not only `close`: a GUI the editor leaves behind may hold stderr open. A failure
    // waits for the rest of stderr a moment.
    child.on('exit', (code, signal) => {
      if (code === 0) return finish({ ok: true })
      child.on('close', () => failed(code, signal))
      setTimeout(() => failed(code, signal), 200)
    })
  })
}

function spawnReason(command: string, err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'ENOENT' ? `${command} not found` : `${command} couldn't start`
}

export interface OpenDeps {
  editor: Editor
  editorCommand: string
  /** The login shell (`editorShell`). */
  shell: string
  env: Record<string, string>
  spawn: typeof nodeSpawn
  /** Electron's `shell.openPath`: '' once opened, else the error. */
  openPath: (path: string) => Promise<string>
  waitMs?: number
}

/**
 * Opens the file `path` (relative to the shown `folder`) with the editor setting (D13, D14).
 * `folder` must be an absolute existing folder and `path` a file whose real path is inside it
 * (`..` or a symlink escaping it, a folder, a missing file are refused before anything runs, D16).
 * The editor gets `folder` and the file's path under it as named, not their real paths, so it
 * matches the window it already has open for the folder.
 */
export async function openFile(
  folder: unknown,
  path: unknown,
  deps: OpenDeps
): Promise<OpenResult> {
  if (typeof folder !== 'string' || !(await isDirectory(folder))) {
    return { ok: false, reason: 'refused' }
  }
  const real = await insideFolder(folder, path)
  if (real === null || typeof path !== 'string' || !(await isFile(real))) {
    return { ok: false, reason: 'refused' }
  }
  return openInFolder(folder, resolve(folder, path), deps)
}

/**
 * Opens the absolute `file` with the editor setting, `folder` as the project folder and the
 * shell's working directory; the caller has checked both (`openFile`, or #68's listed paths).
 */
export async function openInFolder(
  folder: string,
  file: string,
  deps: OpenDeps
): Promise<OpenResult> {
  const plan = editorPlan(deps.editor, deps.editorCommand, deps.shell, folder, file)
  if (plan.kind === 'no-command') return { ok: false, reason: 'no-command' }
  if (plan.kind === 'system') {
    const error = await deps.openPath(file)
    return error === '' ? { ok: true } : { ok: false, reason: 'failed', message: error }
  }
  const run = await runEditor(plan, {
    spawn: deps.spawn,
    env: deps.env,
    cwd: folder,
    ...(deps.waitMs !== undefined && { waitMs: deps.waitMs })
  })
  return run.ok ? run : { ok: false, reason: 'failed', message: run.reason }
}

/** Whether `path` is a regular file (a symlink to one counts). */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
