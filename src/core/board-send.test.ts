import { describe, expect, it } from 'vitest'
import { checkSendText, cleanSendText, MAX_SEND_LENGTH, pasteData } from './board-send'

describe('cleanSendText (#81 D19)', () => {
  it('removes control characters but newline and tab', () => {
    expect(cleanSendText('a\tb\nc\r\x1b[31md\x07\x7f\x9be\u0000')).toBe('a\tb\nc[31mde')
  })

  it('keeps everything else, multi-byte included', () => {
    expect(cleanSendText('go on 🎉 é')).toBe('go on 🎉 é')
  })
})

describe('checkSendText (#81 D19)', () => {
  it('takes the cleaned text up to 100,000 characters, counted as code points', () => {
    const most = '🎉'.repeat(MAX_SEND_LENGTH)
    expect(checkSendText(most)).toEqual({ ok: true, text: most })
    expect(checkSendText(`\x1b${'a'.repeat(MAX_SEND_LENGTH)}`)).toEqual({
      ok: true,
      text: 'a'.repeat(MAX_SEND_LENGTH)
    })
  })

  it('refuses a longer one', () => {
    expect(checkSendText('a'.repeat(MAX_SEND_LENGTH + 1))).toEqual({
      ok: false,
      error: 'board: the text is longer than 100,000 characters'
    })
  })
})

describe('pasteData (#81 D19)', () => {
  it("is what xterm's paste sends: new lines as CR, bracketed when the program asked", () => {
    expect(pasteData('a\nb\r\nc', false)).toBe('a\rb\rc')
    expect(pasteData('go on', true)).toBe('\x1b[200~go on\x1b[201~')
  })
})
