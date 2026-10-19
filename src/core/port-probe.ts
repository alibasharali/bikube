import { connect as netConnect } from 'node:net'

/**
 * Main's probe of dev server ports (#49 D4, D9): which of the asked ports something accepts TCP
 * connections on, on the loopback interface only. The connector is injected for tests.
 */

/** The most ports one probe call takes; the rest are ignored (D9). */
export const MAX_PROBE_PORTS = 32

/** How long a connection may take before the address counts as closed (D4). */
export const PROBE_TIMEOUT_MS = 500

/** The only addresses ever connected to (D9). */
export type LoopbackHost = '127.0.0.1' | '::1'

const HOSTS: readonly LoopbackHost[] = ['127.0.0.1', '::1']

/** Whether `host` accepts a TCP connection on `port` within `timeoutMs`; never rejects. */
export type Connector = (host: LoopbackHost, port: number, timeoutMs: number) => Promise<boolean>

/** The integer ports from 1 to 65535 among the first `MAX_PROBE_PORTS` of `input`, deduplicated. */
function probeablePorts(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const ports = input
    .slice(0, MAX_PROBE_PORTS)
    .filter(
      (port): port is number =>
        typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
    )
  return [...new Set(ports)]
}

/** Whether either loopback address accepts on `port`; a failing connector counts as closed. */
async function isOpen(port: number, connect: Connector): Promise<boolean> {
  const attempts = HOSTS.map((host) =>
    connect(host, port, PROBE_TIMEOUT_MS).then(
      (open) => (open ? Promise.resolve(true) : Promise.reject(new Error('closed'))),
      () => Promise.reject(new Error('closed'))
    )
  )
  return Promise.any(attempts).catch(() => false)
}

/** The ports of `input` something listens on, in their order there (D9). */
export async function probePorts(input: unknown, connect: Connector): Promise<number[]> {
  const ports = probeablePorts(input)
  const open = await Promise.all(ports.map((port) => isOpen(port, connect)))
  return ports.filter((_, i) => open[i])
}

/**
 * Connects to `host`:`port` and closes the connection at once, sending nothing: true when it was
 * accepted within `timeoutMs`.
 */
export const tcpConnect: Connector = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = netConnect({ host, port })
    const done = (open: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(open)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
