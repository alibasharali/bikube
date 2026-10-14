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
 * Owns the PTY sessions. Plain Node: no Electron imports (D5). Emits `data` and `exit`
 * per session id; a session is removed before its `exit` event fires.
 */
export class SessionManager {
  private readonly sessions = new Map<string, pty.IPty>()
  /** Killed sessions not exited yet: never paused again (#16 D5). */
  private readonly ending = new Set<string>()
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
    if (!this.ending.has(id)) this.sessions.get(id)?.pause()
  }

  resume(id: string): void {
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
    proc.resume()
    proc.kill()
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
