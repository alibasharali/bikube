import { beforeEach, describe, expect, it } from 'vitest'
import type { SpawnResult, TerminalApi, TerminalExit } from '../shared/api'
import { SessionRouter, type SessionRoute } from './session-router'

class FakeApi implements TerminalApi {
  spawns: ((r: SpawnResult) => void)[] = []
  dataListeners = new Set<(id: string, data: string) => void>()
  exitListeners = new Set<(exit: TerminalExit) => void>()
  spawn(): Promise<SpawnResult> {
    return new Promise((resolve) => this.spawns.push(resolve))
  }
  // The router never writes, resizes or kills.
  write = (): void => undefined
  resize = (): void => undefined
  kill = (): void => undefined
  acks: [string, number][] = []
  ack(id: string, chars: number): void {
    this.acks.push([id, chars])
  }
  onData(listener: (id: string, data: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }
  onExit(listener: (exit: TerminalExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }
  emitData(id: string, data: string): void {
    this.dataListeners.forEach((l) => l(id, data))
  }
  emitExit(exit: TerminalExit): void {
    this.exitListeners.forEach((l) => l(exit))
  }
}

/** Lets pending spawn replies settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function route(): SessionRoute & { out: string[]; exits: TerminalExit[] } {
  const out: string[] = []
  const exits: TerminalExit[] = []
  return { out, exits, output: (d) => out.push(d), exited: (e) => exits.push(e) }
}

let api: FakeApi
let router: SessionRouter

beforeEach(() => {
  api = new FakeApi()
  router = new SessionRouter(api)
})

describe('SessionRouter', () => {
  it('buffers events only while a spawn is pending and delivers them on adopt', async () => {
    // Nothing pending: an unknown session's output is dropped.
    api.emitData('s0', 'stray')
    const r = route()
    const adopted: ReturnType<SessionRouter['adopt']>[] = []
    router.spawn(80, 24, '/tmp', 'card-1', (result) => {
      if (!result.ok) return
      adopted.push(router.adopt(result.id, r))
      adopted.push(router.adopt('s0', route()))
    })
    api.emitData('s1', 'a')
    api.emitData('s1', 'b')
    api.spawns[0]({ ok: true, id: 's1' })
    await flush()
    // s1's output from before the reply, and nothing of what s0 printed while none was pending.
    expect(adopted).toEqual([{ data: ['a', 'b'] }, { data: [] }])
    expect(r.out).toEqual([])
    api.emitData('s1', 'c')
    expect(r.out).toEqual(['c'])
  })

  it('hands over an exit that arrived before the reply, without routing the session', async () => {
    const r = route()
    let early: ReturnType<SessionRouter['adopt']> | undefined
    router.spawn(80, 24, '/tmp', 'card-1', (result) => {
      if (result.ok) early = router.adopt(result.id, r)
    })
    api.emitData('s1', 'bye')
    api.emitExit({ id: 's1', exitCode: 3 })
    api.spawns[0]({ ok: true, id: 's1' })
    await flush()
    expect(early).toEqual({ data: ['bye'], exit: { id: 's1', exitCode: 3 } })
    // The exit isn't routed again, nor is anything later.
    api.emitExit({ id: 's1', exitCode: 3 })
    api.emitData('s1', 'late')
    expect(r.exits).toEqual([])
    expect(r.out).toEqual([])
  })

  it('routes nothing to a released session, even a late exit while another spawn is pending', async () => {
    const r = route()
    router.spawn(80, 24, '/tmp', 'card-1', (result) => {
      if (result.ok) router.adopt(result.id, r)
    })
    api.spawns[0]({ ok: true, id: 's1' })
    await flush()
    router.release('s1')
    router.spawn(80, 24, '/tmp', 'card-1', () => {})
    api.emitData('s1', 'late')
    api.emitExit({ id: 's1', exitCode: 0 })
    expect(r.out).toEqual([])
    expect(r.exits).toEqual([])
    api.spawns[1]({ ok: false, reason: 'nope' })
    await flush()
    expect(r.exits).toEqual([])
  })

  it('clears the buffer when the last spawn settles without adopting', async () => {
    router.spawn(80, 24, '/tmp', 'card-1', () => {})
    router.spawn(80, 24, '/tmp', 'card-1', () => {})
    api.emitData('s1', 'early')
    api.spawns[0]({ ok: false, reason: 'nope' })
    await flush()
    // Another spawn is still pending: the buffer is kept.
    api.emitData('s1', 'more')
    api.spawns[1]({ ok: true, id: 's2' })
    await flush()
    // Both settled without adopting s1: what it printed is gone.
    expect(router.adopt('s1', route())).toEqual({ data: [] })
  })
})

/** A chunk of `n` characters: 5,000 or more is acknowledged as soon as it is parsed. */
const chunk = (n: number): string => 'x'.repeat(n)

/** A route that keeps each chunk's parsed callback, for the test to run when it likes. */
function slowRoute(): SessionRoute & { parse: (() => void)[] } {
  const parse: (() => void)[] = []
  return { parse, output: (_, parsed) => parse.push(parsed), exited: () => {} }
}

async function adopted(r: SessionRoute, id = 's1'): Promise<void> {
  router.spawn(80, 24, '/tmp', 'card-1', (result) => {
    if (result.ok) router.adopt(result.id, r)
  })
  api.spawns[api.spawns.length - 1]({ ok: true, id })
  await flush()
}

describe('SessionRouter acknowledgements (#16 D4)', () => {
  it('acknowledges a routed chunk once its screen parsed it, in batches', async () => {
    const r = slowRoute()
    await adopted(r)
    api.emitData('s1', chunk(3_000))
    api.emitData('s1', chunk(2_000))
    expect(api.acks).toEqual([])
    r.parse[0]()
    // A callback that runs twice still counts once.
    r.parse[0]()
    expect(api.acks).toEqual([])
    r.parse[1]()
    expect(api.acks).toEqual([['s1', 5_000]])
  })

  it('acknowledges a chunk for an unknown session at once when no spawn is pending', () => {
    api.emitData('s9', chunk(7_000))
    expect(api.acks).toEqual([['s9', 7_000]])
  })

  it('acknowledges early chunks once replayed and parsed', async () => {
    let parse: (() => void)[] = []
    router.spawn(80, 24, '/tmp', 'card-1', (result) => {
      if (!result.ok) return
      const early = router.adopt(result.id, route())
      parse = early.data.map((data) => router.ackWhenParsed(result.id, data))
    })
    api.emitData('s1', chunk(4_000))
    api.emitData('s1', chunk(1_000))
    api.spawns[0]({ ok: true, id: 's1' })
    await flush()
    expect(api.acks).toEqual([])
    parse.forEach((parsed) => parsed())
    expect(api.acks).toEqual([['s1', 5_000]])
  })

  it('acknowledges early chunks at once when the last spawn settles without adopting them', async () => {
    router.spawn(80, 24, '/tmp', 'card-1', () => {})
    api.emitData('s1', chunk(1_000))
    api.emitData('s1', chunk(2_000))
    api.emitData('s2', chunk(10))
    api.spawns[0]({ ok: false, reason: 'nope' })
    await flush()
    expect(api.acks).toEqual([
      ['s1', 3_000],
      ['s2', 10]
    ])
  })

  it('acknowledges chunks not parsed yet at once when the session is released', async () => {
    const r = slowRoute()
    await adopted(r)
    api.emitData('s1', chunk(1_000))
    api.emitData('s1', chunk(2_000))
    r.parse[0]()
    router.release('s1')
    expect(api.acks).toEqual([['s1', 3_000]])
    // The screen parsing it later doesn't count it again.
    r.parse[1]()
    expect(api.acks).toEqual([['s1', 3_000]])
  })

  it('acknowledges parsed characters still batched when a fully parsed session is released', async () => {
    const r = slowRoute()
    await adopted(r)
    api.emitData('s1', chunk(3_000))
    r.parse[0]()
    expect(api.acks).toEqual([])
    router.release('s1')
    expect(api.acks).toEqual([['s1', 3_000]])
  })

  it('drops what a session held back once it exits', async () => {
    const r = slowRoute()
    await adopted(r)
    api.emitData('s1', chunk(1_000))
    api.emitData('s1', chunk(2_000))
    r.parse[0]()
    api.emitExit({ id: 's1', exitCode: 0 })
    r.parse[1]()
    expect(api.acks).toEqual([])
  })
})
