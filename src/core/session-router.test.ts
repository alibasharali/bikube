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
