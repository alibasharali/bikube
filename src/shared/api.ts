/** IPC channel names shared by main and preload. */
export const IPC = {
  spawn: 'terminal:spawn',
  write: 'terminal:write',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  data: 'terminal:data',
  exit: 'terminal:exit'
} as const

export interface TerminalExit {
  id: string
  exitCode: number
  signal?: number
}

/** Terminal operations the renderer may use; main owns the PTYs (D6). */
export interface TerminalApi {
  /** Starts the login shell in the home directory; resolves to the session id. */
  spawn(cols: number, rows: number): Promise<string>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  /** Returns an unsubscribe function. */
  onData(listener: (id: string, data: string) => void): () => void
  onExit(listener: (exit: TerminalExit) => void): () => void
}

/** The typed surface the preload script exposes to the renderer as `window.drovr`. Grows with each feature. */
export interface DrovrApi {
  platform: NodeJS.Platform
  terminal: TerminalApi
}
