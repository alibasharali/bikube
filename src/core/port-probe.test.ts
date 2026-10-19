import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_PROBE_PORTS,
  PROBE_TIMEOUT_MS,
  probePorts,
  tcpConnect,
  type Connector,
  type LoopbackHost
} from './port-probe'

/** A connector recording every attempt, accepting where `open` says so. */
function fakeConnector(open: (host: LoopbackHost, port: number) => boolean | Promise<boolean>): {
  connect: Connector
  calls: { host: LoopbackHost; port: number; timeoutMs: number }[]
} {
  const calls: { host: LoopbackHost; port: number; timeoutMs: number }[] = []
  return {
    calls,
    connect: async (host, port, timeoutMs) => {
      calls.push({ host, port, timeoutMs })
      return open(host, port)
    }
  }
}

describe('probePorts (#49 D9, AC11)', () => {
  it('answers only the integer ports from 1 to 65535 among the first 32', async () => {
    const { connect, calls } = fakeConnector(() => true)
    const input = [0, 1, 65535, 65536, -3, 80.5, '81', null, NaN, 80, 80]
    expect(await probePorts(input, connect)).toEqual([1, 65535, 80])
    expect(new Set(calls.map((c) => c.port))).toEqual(new Set([1, 65535, 80]))

    const many = Array.from({ length: 40 }, (_, i) => 1000 + i)
    expect(await probePorts(many, connect)).toEqual(many.slice(0, MAX_PROBE_PORTS))
    expect(await probePorts('80', connect)).toEqual([])
    expect(await probePorts(undefined, connect)).toEqual([])
  })

  it('connects only to 127.0.0.1 and ::1, each within 500 ms', async () => {
    const { connect, calls } = fakeConnector(() => false)
    expect(await probePorts([5173], connect)).toEqual([])
    expect(calls.map((c) => c.host).sort()).toEqual(['127.0.0.1', '::1'])
    expect(calls.every((c) => c.port === 5173 && c.timeoutMs === PROBE_TIMEOUT_MS)).toBe(true)
    expect(PROBE_TIMEOUT_MS).toBe(500)
  })

  it('counts a port open when either address accepts', async () => {
    const { connect } = fakeConnector((host, port) =>
      port === 1 ? host === '127.0.0.1' : port === 2 ? host === '::1' : false
    )
    expect(await probePorts([1, 2, 3], connect)).toEqual([1, 2])
  })

  it('counts a connector that throws as closed', async () => {
    const connect: Connector = async () => {
      throw new Error('boom')
    }
    expect(await probePorts([1], connect)).toEqual([])
  })
})

describe('tcpConnect', () => {
  let server: Server | undefined

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = undefined
  })

  it('accepts on a listening port without sending anything, and refuses a closed one', async () => {
    const received: Buffer[] = []
    let ended: () => void = () => {}
    const closed = new Promise<void>((resolve) => (ended = resolve))
    server = createServer((socket) => {
      socket.on('data', (data) => received.push(data))
      socket.on('close', () => ended())
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    expect(await tcpConnect('127.0.0.1', port, PROBE_TIMEOUT_MS)).toBe(true)
    await closed
    expect(received).toEqual([])

    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = undefined
    expect(await tcpConnect('127.0.0.1', port, PROBE_TIMEOUT_MS)).toBe(false)
  })
})
