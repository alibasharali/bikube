import { ipcMain } from 'electron'
import { probePorts, tcpConnect } from '../core/port-probe'
import { IPC } from '../shared/api'

/**
 * Probes dev server ports on the loopback interface (#49 D9), for a window's own top-level page
 * only: anything else gets no open ports.
 */
export function registerPorts(): void {
  ipcMain.handle(IPC.portsProbe, async (event, ports: unknown) => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) return []
    return probePorts(ports, tcpConnect)
  })
}
