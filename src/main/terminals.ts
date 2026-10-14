import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { acknowledgeRequest } from '../core/ack-request'
import { FlowControl } from '../core/flow-control'
import {
  SPAWN_REFUSAL,
  isCardId,
  isCurrentMainFrame,
  isSessionId,
  isValidSize,
  isWriteData
} from '../core/ipc-guards'
import { PageGenerations } from '../core/page-generations'
import { SessionCards } from '../core/session-cards'
import { SessionManager } from '../core/session-manager'
import { SessionOwners } from '../core/session-owners'
import { spawnInDirectory } from '../core/terminal-spawn'
import { IPC, type TerminalExit } from '../shared/api'

export interface Terminals {
  /** The number of live sessions. */
  readonly sessionCount: number
  /** Kills every session (#18 D1); resolves once all of them have exited. */
  killAll(): Promise<void>
  /** SIGKILLs every live session's shell, synchronously (#18 D2). */
  forceKillAll(): void
  /**
   * The window whose page owns the card's live session (#9 D10): undefined when the card has
   * no live session in this run, null when that window is gone.
   */
  ownerOfCard(cardId: string): WebContents | null | undefined
  /** Called with each window once it is gone, after its sessions were killed. */
  onWindowGone(listener: (owner: WebContents) => void): void
  /** Called with each window whose page reloaded or crashed, after its sessions were killed. */
  onPageGone(listener: (owner: WebContents) => void): void
}

/**
 * Wires the session manager to IPC. Sessions stream to the window that spawned them; each
 * local shell gets its card's `board` variables from `shellEnv` (#9 D3), an SSH card's none
 * (#12 D5).
 */
export function registerTerminals(shellEnv: (cardId: string) => Record<string, string>): Terminals {
  const manager = new SessionManager()
  // Pauses a session's PTY while the renderer is behind on parsing its output (#16 D1).
  const flow = new FlowControl(manager)
  // The benchmark's backlog reading (#16 D7), read through `app.evaluate`; only when it runs.
  if (process.env.DROVR_BENCH) {
    ;(globalThis as { __drovrFlowPeak?: { read(): number; reset(): void } }).__drovrFlowPeak = {
      read: () => flow.peakUnacked(),
      reset: () => flow.resetPeak()
    }
  }
  const owners = new SessionOwners<WebContents>()
  const pages = new PageGenerations<WebContents>()
  const cards = new SessionCards()
  const goneListeners: ((owner: WebContents) => void)[] = []
  const pageGoneListeners: ((owner: WebContents) => void)[] = []

  manager.on('data', (id, data) => {
    const owner = owners.ownerOf(id)
    if (!owner || owner.isDestroyed()) return
    owner.send(IPC.data, id, data)
    // Only what was sent counts: nothing else will ever be acknowledged (#16 D1).
    flow.sent(id, data.length)
  })
  manager.on('exit', (id, { exitCode, signal }) => {
    const owner = owners.ownerOf(id)
    owners.remove(id)
    cards.remove(id)
    flow.forget(id)
    const exit: TerminalExit = { id, exitCode, signal }
    if (owner && !owner.isDestroyed()) owner.send(IPC.exit, exit)
  })

  // Only a window's own top-level page may drive terminals, never a subframe.
  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame
  // Calls on an existing session must come from the window that spawned it.
  const ownedBy = (event: IpcMainEvent, id: unknown): id is string =>
    fromMainFrame(event) && isSessionId(id) && owners.ownerOf(id) === event.sender

  // Hooked once per window, on its first spawn request: a window's shells end with its page.
  const watch = (owner: WebContents): void => {
    const pageGone = (): void => {
      pages.bump(owner)
      owners.sessionsOf(owner).forEach((id) => flow.kill(id))
      pageGoneListeners.forEach((listener) => listener(owner))
    }
    owner.once('destroyed', () => {
      pages.release(owner)
      owners.release(owner).forEach((id) => flow.kill(id))
      goneListeners.forEach((listener) => listener(owner))
    })
    // A reload or crash leaves the old page's shells with no UI to drive them; a spawn still
    // checking its directory for the old page must not start one either. Only a committed
    // main-frame navigation counts: one the navigation lock cancels starts but never commits.
    owner.on('did-navigate', pageGone)
    owner.on('render-process-gone', pageGone)
  }

  ipcMain.handle(
    IPC.spawn,
    async (event, cols: unknown, rows: unknown, cwd: unknown, cardId: unknown, host: unknown) => {
      if (!fromMainFrame(event)) throw new Error('terminal:spawn rejected: untrusted sender')
      if (!isCardId(cardId)) return { ok: false, reason: SPAWN_REFUSAL.invalidCard }
      const owner = event.sender
      if (pages.track(owner)) watch(owner)
      const samePage = pages.snapshot(owner)
      // Re-checked after the directory check: no spawn for a page that reloaded or closed meanwhile.
      // The frame check catches an old page's request that main only handled after the reload.
      const result = await spawnInDirectory(
        { cols, rows, cwd, host },
        // An SSH card's local shell gets none of the `board` variables (#12 D5, D9).
        (options) =>
          manager.spawn({
            ...options,
            env: options.command === undefined ? shellEnv(cardId) : undefined
          }),
        {
          stillCurrent: () =>
            samePage() &&
            !owner.isDestroyed() &&
            isCurrentMainFrame(event.senderFrame, owner.mainFrame)
        }
      )
      if (result.ok) {
        owners.add(owner, result.id)
        cards.add(result.id, cardId)
      }
      return result
    }
  )
  ipcMain.on(IPC.write, (event, id: unknown, data: unknown) => {
    if (ownedBy(event, id) && isWriteData(data)) manager.write(id, data)
  })
  ipcMain.on(IPC.resize, (event, id: unknown, cols: unknown, rows: unknown) => {
    if (ownedBy(event, id) && isValidSize(cols, rows)) {
      manager.resize(id, cols as number, rows as number)
    }
  })
  ipcMain.on(IPC.kill, (event, id: unknown) => {
    if (ownedBy(event, id)) flow.kill(id)
  })
  // Fire-and-forget like `write`; anything but a positive safe integer is ignored (#16 D3).
  ipcMain.on(IPC.ack, (event, id: unknown, chars: unknown) => {
    acknowledgeRequest((session): session is string => ownedBy(event, session), id, chars, flow)
  })

  return {
    get sessionCount() {
      return manager.size
    },
    killAll: () => manager.killAll(),
    forceKillAll: () => manager.forceKillAll(),
    ownerOfCard: (cardId) => {
      const session = cards.sessionOf(cardId)
      if (session === undefined || !manager.has(session)) return undefined
      const owner = owners.ownerOf(session)
      return owner && !owner.isDestroyed() ? owner : null
    },
    onWindowGone: (listener) => goneListeners.push(listener),
    onPageGone: (listener) => pageGoneListeners.push(listener)
  }
}
