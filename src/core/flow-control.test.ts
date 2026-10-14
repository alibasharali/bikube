import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACK_BATCH_CHARS,
  FlowControl,
  HIGH_WATERMARK,
  LOW_WATERMARK,
  type FlowTarget
} from './flow-control'

/** Records what flow control does to the PTYs, in order. */
class FakePty implements FlowTarget {
  calls: string[] = []
  pause(id: string): void {
    this.calls.push(`pause ${id}`)
  }
  resume(id: string): void {
    this.calls.push(`resume ${id}`)
  }
  kill(id: string): void {
    this.calls.push(`kill ${id}`)
  }
}

let pty: FakePty
let flow: FlowControl

beforeEach(() => {
  pty = new FakePty()
  flow = new FlowControl(pty)
})

describe('flow-control constants (#16 D2)', () => {
  it('are VS Code’s values', () => {
    expect(HIGH_WATERMARK).toBe(100_000)
    expect(LOW_WATERMARK).toBe(5_000)
    expect(ACK_BATCH_CHARS).toBe(5_000)
  })
})

describe('FlowControl (#16 D1)', () => {
  it('pauses once above the high watermark and resumes once below the low one', () => {
    flow.sent('1', 100_000)
    expect(pty.calls).toEqual([])
    flow.sent('1', 1)
    expect(pty.calls).toEqual(['pause 1'])
    flow.acknowledged('1', 95_001)
    expect(flow.unacked('1')).toBe(5_000)
    expect(pty.calls).toEqual(['pause 1'])
    flow.acknowledged('1', 1)
    expect(pty.calls).toEqual(['pause 1', 'resume 1'])
    flow.acknowledged('1', 100)
    expect(pty.calls).toEqual(['pause 1', 'resume 1'])
  })

  it('counts each session on its own', () => {
    flow.sent('1', 60_000)
    flow.sent('2', 60_000)
    expect(pty.calls).toEqual([])
    flow.sent('2', 50_000)
    expect(pty.calls).toEqual(['pause 2'])
    expect(flow.unacked('1')).toBe(60_000)
    flow.acknowledged('2', 50_000)
    expect(flow.unacked('1')).toBe(60_000)
  })

  it('clamps an over-acknowledgement at 0 (#16 D3)', () => {
    flow.sent('1', 10)
    flow.acknowledged('1', 1_000)
    expect(flow.unacked('1')).toBe(0)
    flow.sent('1', 100_000)
    expect(pty.calls).toEqual([])
  })

  it('ignores an acknowledgement for a session it never sent to or forgot', () => {
    flow.acknowledged('9', 10)
    expect(flow.unacked('9')).toBe(0)
    flow.sent('1', 200_000)
    flow.forget('1')
    flow.acknowledged('1', 200_000)
    expect(flow.unacked('1')).toBe(0)
    expect(pty.calls).toEqual(['pause 1'])
  })

  it('resumes a paused session before killing it, and never pauses it again (#16 D5)', () => {
    flow.sent('1', 100_001)
    flow.kill('1')
    expect(pty.calls).toEqual(['pause 1', 'resume 1', 'kill 1'])
    // What the shell prints until it exits still streams.
    flow.sent('1', 200_000)
    expect(pty.calls).toEqual(['pause 1', 'resume 1', 'kill 1'])
  })

  it('kills a session that isn’t paused without resuming it', () => {
    flow.sent('1', 10)
    flow.kill('1')
    flow.kill('2')
    expect(pty.calls).toEqual(['kill 1', 'kill 2'])
  })
})

describe('FlowControl peak (#16 D7, benchmark)', () => {
  it('reports the most characters any session had unacknowledged since the last reset', () => {
    expect(flow.peakUnacked()).toBe(0)
    flow.sent('1', 30_000)
    flow.sent('2', 50_000)
    flow.sent('1', 10_000)
    flow.acknowledged('2', 50_000)
    flow.sent('1', 5_000)
    expect(flow.peakUnacked()).toBe(50_000)
    flow.resetPeak()
    expect(flow.peakUnacked()).toBe(45_000)
    flow.acknowledged('1', 45_000)
    flow.sent('2', 1_000)
    expect(flow.peakUnacked()).toBe(45_000)
    flow.resetPeak()
    expect(flow.peakUnacked()).toBe(1_000)
  })
})
