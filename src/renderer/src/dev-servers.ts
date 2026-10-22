import { useSyncExternalStore } from 'react'
import { DevServers, type DevServerUrl } from '../../core/dev-servers'
import { anyWindowFocused, onAnyWindowFocus } from './window-focus'

/**
 * The app-wide dev server ports of cards and shells (#49): fed by `cardTerminals()` from each
 * local main pane's output, probed by main every 3 s while a Bikube window is focused and at once
 * when one gains the focus (D4; a card's own window counts, #53 D10).
 */
let registry: DevServers | undefined

export function devServers(): DevServers {
  registry ??= new DevServers({
    probe: (ports) => window.bikube.ports.probe(ports),
    focused: anyWindowFocused,
    onFocus: (listener) => void onAnyWindowFocus(listener),
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
