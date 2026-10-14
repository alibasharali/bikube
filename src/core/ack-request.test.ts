import { beforeEach, describe, expect, it } from 'vitest'
import { acknowledgeRequest } from './ack-request'
import { FlowControl, HIGH_WATERMARK, type FlowTarget } from './flow-control'

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
/** The window owns session 1 only. */
const isOwner = (id: unknown): id is string => id === '1'

beforeEach(() => {
  pty = new FakePty()
  flow = new FlowControl(pty)
  // Both sessions paused: an acknowledgement that counted would resume one.
  flow.sent('1', HIGH_WATERMARK + 1)
  flow.sent('2', HIGH_WATERMARK + 1)
  pty.calls = []
})

describe('acknowledgeRequest (#16 D3)', () => {
  it("acknowledges the window's own session", () => {
    acknowledgeRequest(isOwner, '1', HIGH_WATERMARK, flow)
    expect(flow.unacked('1')).toBe(1)
    expect(pty.calls).toEqual(['resume 1'])
  })

  it("leaves a session that isn't the window's unchanged", () => {
    acknowledgeRequest(isOwner, '2', HIGH_WATERMARK, flow)
    expect(flow.unacked('2')).toBe(HIGH_WATERMARK + 1)
    expect(pty.calls).toEqual([])
  })

  it.each([0, -5, 1.5, '100', NaN, Infinity, undefined])('ignores chars %s', (chars) => {
    acknowledgeRequest(isOwner, '1', chars, flow)
    expect(flow.unacked('1')).toBe(HIGH_WATERMARK + 1)
    expect(pty.calls).toEqual([])
  })
})
