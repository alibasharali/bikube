import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import * as pty from 'node-pty'

export interface SpawnOptions {
  cols: number
  rows: number
  /** Defaults to `$SHELL`, falling back to `/bin/bash`. */
  shell?: string
  /** Defaults to the user's home directory. */
  cwd?: string
  /**
   * Run with `-c` by the login shell instead of an interactive session, e.g. an SSH card's
   * `exec ssh …` line (#12 D5).
   */
  command?: string
  /** Variables added to the inherited environment, e.g. the card's `board` variables (#9 D3). */
  env?: Record<string, string>
}

export interface SessionExit {
  exitCode: number
  signal?: number
}

export interface SessionInfo {
  id: string
  pid: number
}

interface Events {
  data: [id: string, data: string]
  exit: [id: string, exit: SessionExit]
}

/**
 * How often a paused session checks whether its shell exited by itself (#16 D1, D5): well
 * within node-pty's 200 ms before it drops a reaped shell's unread output.
 */
const EXIT_CHECK_MS = 50

/**
 * Owns the PTY sessions. Plain Node: no Electron imports (D5). Emits `data` and `exit`
 * per session id; a session is removed before its `exit` event fires.
 */
export class SessionManager {
  private readonly sessions = new Map<string, pty.IPty>()
  /** Killed sessions not exited yet: never paused again (#16 D5). */
  private readonly ending = new Set<string>()
  /** Paused sessions' checks for a shell that exited by itself (#16 D1, D5). */
  private readonly exitChecks = new Map<string, NodeJS.Timeout>()
  private readonly emitter = new EventEmitter()
  private nextId = 1

  static defaultShell(env: NodeJS.ProcessEnv = process.env): string {
    return env.SHELL || '/bin/bash'
  }

  get size(): number {
    return this.sessions.size
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  spawn(options: SpawnOptions): SessionInfo {
    const shell = options.shell ?? SessionManager.defaultShell()
    const id = String(this.nextId++)
    const args = options.command === undefined ? ['-l'] : ['-l', '-c', options.command]
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd ?? homedir(),
      env: {
        ...process.env,
        ...options.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      } as Record<string, string>
    })
    this.sessions.set(id, proc)
    proc.onData((data) => this.emitter.emit('data', id, data))
    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      this.ending.delete(id)
      this.stopExitCheck(id)
      this.emitter.emit('exit', id, { exitCode, signal })
    })
    return { id, pid: proc.pid }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return
    this.sessions.get(id)?.resize(cols, rows)
  }

  /** Stops reading the session's output (#16 D1); the shell blocks once the PTY buffer fills. */
  pause(id: string): void {
    const proc = this.sessions.get(id)
    if (!proc || this.ending.has(id)) return
    proc.pause()
    if (!this.exitChecks.has(id)) {
      const check = setInterval(() => {
        if (!SessionManager.reaped(proc.pid)) return
        // node-pty reaped the shell and drops what is still unread after 200 ms: resumed for good.
        this.ending.add(id)
        this.stopExitCheck(id)
        proc.resume()
      }, EXIT_CHECK_MS)
      check.unref()
      this.exitChecks.set(id, check)
    }
  }

  resume(id: string): void {
    this.stopExitCheck(id)
    this.sessions.get(id)?.resume()
  }

  /**
   * Resumes the session first (#16 D5): a paused PTY would drop what the shell printed until
   * its hangup, and node-pty only reports the exit once it read to the end.
   */
  kill(id: string): void {
    const proc = this.sessions.get(id)
    if (!proc) return
    this.ending.add(id)
    this.stopExitCheck(id)
    proc.resume()
    proc.kill()
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  private stopExitCheck(id: string): void {
    clearInterval(this.exitChecks.get(id))
    this.exitChecks.delete(id)
  }

  /** True once process `pid` no longer exists: node-pty has reaped it. */
  private static reaped(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }
}
