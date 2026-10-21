import { describe, expect, it } from 'vitest'
import { triggerStatus, triggerStatusLabel } from './trigger-status'

describe('triggerStatus', () => {
  it('is idle before a run and after a Close', () => {
    expect(triggerStatus(undefined, [])).toEqual({ kind: 'idle' })
    expect(triggerStatus({ kind: 'stopped' }, [])).toEqual({ kind: 'idle' })
  })

  it('runs until a port it printed listens, then serves', () => {
    expect(triggerStatus({ kind: 'running' }, [])).toEqual({ kind: 'running' })
    expect(triggerStatus({ kind: 'running' }, [{ port: 5173 }, { port: 24678 }])).toEqual({
      kind: 'serving',
      port: 5173
    })
  })

  it('is done for exit 0, failed for any other code or a failed start', () => {
    expect(
      triggerStatus({ kind: 'stopped', exit: { code: 0, line: 'built', tail: ['built'] } }, [])
    ).toEqual({
      kind: 'done',
      line: 'built'
    })
    const tail = ['$ tsc', 'src/a.ts(1,1)', 'error TS']
    expect(
      triggerStatus({ kind: 'stopped', exit: { code: 2, line: 'error TS', tail } }, [])
    ).toEqual({ kind: 'failed', code: 2, line: 'error TS', tail })
    expect(triggerStatus({ kind: 'failed', reason: 'working directory not found' }, [])).toEqual({
      kind: 'failed',
      code: null,
      line: 'working directory not found',
      tail: ['working directory not found']
    })
  })
})

describe('triggerStatusLabel', () => {
  it('names each status, with the exit code and the last line', () => {
    expect(triggerStatusLabel({ kind: 'idle' })).toBe('Not running')
    expect(triggerStatusLabel({ kind: 'running' })).toBe('Running')
    expect(triggerStatusLabel({ kind: 'serving', port: 5173 })).toBe(
      'Running, listening on localhost:5173'
    )
    expect(triggerStatusLabel({ kind: 'done', line: '' })).toBe('Done')
    expect(triggerStatusLabel({ kind: 'failed', code: 2, line: 'error TS2304', tail: [] })).toBe(
      'Failed (exit 2): error TS2304'
    )
    expect(triggerStatusLabel({ kind: 'failed', code: null, line: 'no folder', tail: [] })).toBe(
      "Couldn't start: no folder"
    )
  })
})
