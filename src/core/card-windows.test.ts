import { describe, expect, it } from 'vitest'
import { cardWindowName } from './card-window-name'
import { cardWindowOpen, cardWindowOptions } from './card-windows'

describe('cardWindowOpen', () => {
  const open = { url: 'about:blank', frameName: cardWindowName('c1'), fromMainWindow: true }

  it("allows the main window's about:blank named after a card, giving the card id", () => {
    expect(cardWindowOpen(open)).toBe('c1')
  })

  it('denies any other URL', () => {
    expect(cardWindowOpen({ ...open, url: 'https://example.com' })).toBeNull()
    expect(cardWindowOpen({ ...open, url: 'about:blank#x' })).toBeNull()
    expect(cardWindowOpen({ ...open, url: 'file:///etc/passwd' })).toBeNull()
  })

  it('denies any other frame name or an invalid card id', () => {
    expect(cardWindowOpen({ ...open, frameName: 'x' })).toBeNull()
    expect(cardWindowOpen({ ...open, frameName: '' })).toBeNull()
    expect(cardWindowOpen({ ...open, frameName: 'bikube-card:' })).toBeNull()
    expect(cardWindowOpen({ ...open, frameName: `bikube-card:${'a'.repeat(101)}` })).toBeNull()
  })

  it('denies an open from anything but the main window', () => {
    expect(cardWindowOpen({ ...open, fromMainWindow: false })).toBeNull()
  })
})

describe('cardWindowOptions', () => {
  it('is a 900×640 window with the background and no preload, sandboxed and isolated', () => {
    const options = cardWindowOptions('linux', '#101010')
    expect(options).toMatchObject({ width: 900, height: 640, backgroundColor: '#101010' })
    expect(options).not.toHaveProperty('x')
    expect(options).not.toHaveProperty('y')
    expect(options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: undefined
    })
  })

  it('hides the menu bar off macOS and keeps the standard title bar on macOS', () => {
    expect(cardWindowOptions('linux', '#fff').autoHideMenuBar).toBe(true)
    const mac = cardWindowOptions('darwin', '#fff')
    expect(mac.autoHideMenuBar).toBe(false)
    expect(mac).not.toHaveProperty('titleBarStyle')
  })
})
