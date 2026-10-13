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
    const proc = pty.spawn(shell, ['-l'], {
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

  kill(id: string): void {
    this.sessions.get(id)?.kill()
  }

  killAll(): void {
    for (const proc of this.sessions.values()) proc.kill()
  }
}
