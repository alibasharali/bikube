import { useSyncExternalStore } from 'react'
import { DevServers, type DevServerUrl } from '../../core/dev-servers'

/**
 * The app-wide dev server ports of cards and shells (#49): fed by `cardTerminals()` from each
 * local main pane's output, probed by main every 3 s while the window is focused and at once on
 * focus (D4).
 */
let registry: DevServers | undefined

export function devServers(): DevServers {
  registry ??= new DevServers({
    probe: (ports) => window.drovr.ports.probe(ports),
    focused: () => document.hasFocus(),
    onFocus: (listener) => window.addEventListener('focus', listener),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
  })
  return registry
}

/** The card's (or shell's) listening dev server ports, in chip order (D3, D4). */
export function useDevServers(cardId: string): readonly DevServerUrl[] {
  return useSyncExternalStore(
    (listener) => devServers().subscribe(cardId, listener),
    () => devServers().ports(cardId)
  )
}
