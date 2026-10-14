import { beforeEach, describe, expect, it } from 'vitest'
import { AckBatcher } from './ack-batcher'

let acks: [string, number][]
let batcher: AckBatcher

beforeEach(() => {
  acks = []
  batcher = new AckBatcher((id, chars) => acks.push([id, chars]))
})

describe('AckBatcher (#16 D2, D4)', () => {
  it('acknowledges a session once it holds 5,000 parsed characters', () => {
    batcher.parsed('1', 4_999)
    expect(acks).toEqual([])
    batcher.parsed('1', 1)
    expect(acks).toEqual([['1', 5_000]])
    batcher.parsed('1', 7_000)
    expect(acks).toEqual([
      ['1', 5_000],
      ['1', 7_000]
    ])
  })

  it('counts each session separately', () => {
    batcher.parsed('1', 3_000)
    batcher.parsed('2', 3_000)
    expect(acks).toEqual([])
    batcher.parsed('2', 2_000)
    expect(acks).toEqual([['2', 5_000]])
  })

  it('acknowledges a discarded chunk at once, with whatever was pending', () => {
    batcher.discarded('1', 7_000)
    expect(acks).toEqual([['1', 7_000]])
    batcher.parsed('2', 100)
    batcher.discarded('2', 7_000)
    expect(acks).toEqual([
      ['1', 7_000],
      ['2', 7_100]
    ])
    // Nothing is left pending for session 2.
    batcher.parsed('2', 4_999)
    expect(acks).toHaveLength(2)
  })

  it('drops the pending count of a session that ended', () => {
    batcher.parsed('1', 4_000)
    batcher.forget('1')
    batcher.parsed('1', 1_000)
    expect(acks).toEqual([])
    batcher.parsed('1', 4_000)
    expect(acks).toEqual([['1', 5_000]])
  })

  it('never sends an empty acknowledgement', () => {
    batcher.parsed('1', 0)
    batcher.discarded('1', 0)
    expect(acks).toEqual([])
  })
})
