import { describe, expect, it } from 'vitest'
import {
  LONG_COMMAND_MS,
  longCommandMsArg,
  longCommandNotice,
  parseLongCommandMs
} from './long-commands'

const away = { windowFocused: false, openId: null, focusedPane: 'main' }
const here = { cardId: 'c1', paneId: 'pane-1' }
const ended = (
  ms: number,
  exitCode: number
): { line: number; start: number; end: number; exitCode: number } => ({
  line: 0,
  start: 1_000,
  end: 1_000 + ms,
  exitCode
})

describe('longCommandNotice (#45 D7)', () => {
  it('tells of a command that ran 10 s or more, by its exit code', () => {
    expect(LONG_COMMAND_MS).toBe(10_000)
    expect(longCommandNotice(ended(10_000, 0), here, away, 'alpha')).toEqual({
      body: 'Command finished · alpha'
    })
    expect(longCommandNotice(ended(12_000, 4), here, away, 'alpha')).toEqual({
      body: 'Command failed (exit 4) · alpha'
    })
  })

  it('says nothing of a shorter command, or one not ended', () => {
    expect(longCommandNotice(ended(9_999, 1), here, away, 'alpha')).toBeNull()
    expect(longCommandNotice({ start: 0 }, here, away, 'alpha')).toBeNull()
  })

  it('takes a shorter threshold', () => {
    expect(longCommandNotice(ended(200, 4), here, away, 'alpha', 200)).toEqual({
      body: 'Command failed (exit 4) · alpha'
    })
    expect(longCommandNotice(ended(199, 4), here, away, 'alpha', 200)).toBeNull()
  })

  it('says nothing for the focused pane of the open card in the focused window', () => {
    const looking = { windowFocused: true, openId: 'c1', focusedPane: 'pane-1' }
    expect(longCommandNotice(ended(20_000, 4), here, looking, 'alpha')).toBeNull()
  })

  it('tells when the window, the card or the pane is not the one in view', () => {
    const body = { body: 'Command failed (exit 4) · alpha' }
    const command = ended(20_000, 4)
    const looking = { windowFocused: true, openId: 'c1', focusedPane: 'pane-1' }
    expect(longCommandNotice(command, here, { ...looking, windowFocused: false }, 'alpha')).toEqual(
      body
    )
    expect(longCommandNotice(command, here, { ...looking, openId: 'c2' }, 'alpha')).toEqual(body)
    expect(longCommandNotice(command, here, { ...looking, openId: null }, 'alpha')).toEqual(body)
    expect(longCommandNotice(command, here, { ...looking, focusedPane: 'main' }, 'alpha')).toEqual(
      body
    )
  })
})

describe('the development build’s threshold argument', () => {
  it('round-trips a positive whole number of ms, and ignores anything else', () => {
    expect(parseLongCommandMs(['electron', longCommandMsArg(200)])).toBe(200)
    expect(parseLongCommandMs(['electron'])).toBeUndefined()
    expect(parseLongCommandMs(['--drovr-long-command-ms=0'])).toBeUndefined()
    expect(parseLongCommandMs(['--drovr-long-command-ms=abc'])).toBeUndefined()
    expect(parseLongCommandMs(['--drovr-long-command-ms=1.5'])).toBeUndefined()
  })
})
