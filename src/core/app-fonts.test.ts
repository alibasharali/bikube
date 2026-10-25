import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_FONT_CHOICES, UI_FONT_STACK, appFontChoiceOf, appFontOf } from './app-fonts'

describe('the App font list (#66 D7)', () => {
  it("keeps the system UI stack equal to main.css's --font-ui", () => {
    const css = readFileSync(new URL('../renderer/src/assets/main.css', import.meta.url), 'utf8')
    const declared = /--font-ui:\s*([^;]+);/.exec(css)?.[1]
    expect(declared).toBe(UI_FONT_STACK)
  })

  it('lists common UI fonts', () => {
    for (const name of ['Inter', 'Segoe UI', 'Roboto', 'Ubuntu', 'Noto Sans', 'Arial']) {
      expect(APP_FONT_CHOICES).toContain(name)
    }
  })

  it('saves a listed font quoted, falling back to the system UI stack', () => {
    expect(appFontOf('Inter')).toBe(`"Inter", ${UI_FONT_STACK}`)
  })

  it('reads the default, a listed font and anything else as Custom', () => {
    expect(appFontChoiceOf('')).toEqual({ kind: 'default' })
    expect(appFontChoiceOf(appFontOf('Roboto'))).toEqual({ kind: 'font', name: 'Roboto' })
    expect(appFontChoiceOf('Courier New')).toEqual({ kind: 'custom' })
    expect(appFontChoiceOf('"Comic Sans", sans-serif')).toEqual({ kind: 'custom' })
    expect(appFontChoiceOf(`"Comic Sans", ${UI_FONT_STACK}`)).toEqual({ kind: 'custom' })
  })
})
