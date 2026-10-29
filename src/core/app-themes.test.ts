import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  APP_THEME_IDS,
  APP_THEME_TOKENS,
  APP_THEMES,
  appThemeArg,
  appThemeStylesheet,
  appThemeTokens,
  parseAppThemeArg,
  windowBackground,
  type AppThemeTokens
} from './app-themes'
import { contrastRatio, composite } from './contrast'

const VERSIONS = ['dark', 'light'] as const

/** The custom properties of a `:root { … }` block, by name without the leading `--`. */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim().replace(/\s+/g, ' ')
  }
  return out
}

/** The app stylesheet without its comments, which may hold braces and colons. */
function stylesheet(): string {
  return readFileSync(new URL('../renderer/src/assets/main.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
}

/** The app stylesheet's dark `:root` block and the light one under `prefers-color-scheme`. */
function stylesheetBlocks(): { dark: Record<string, string>; light: Record<string, string> } {
  const css = stylesheet()
  const dark = /^:root\s*\{([^}]*)\}/m.exec(css)
  const light = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)
  if (!dark || !light) throw new Error('main.css has no dark or light :root block')
  return { dark: declarations(dark[1]), light: declarations(light[1]) }
}

describe('the app themes table (#64 D2, D3, AC1)', () => {
  it('has the six themes of D2 in order, each version holding every token', () => {
    expect(APP_THEMES.map((theme) => [theme.id, theme.name])).toEqual([
      ['default', 'Default'],
      ['bikube', 'Bikube'],
      ['catppuccin', 'Catppuccin'],
      ['rose-pine', 'Rosé Pine'],
      ['nord', 'Nord'],
      ['gruvbox', 'Gruvbox']
    ])
    expect(APP_THEMES.map((theme) => theme.id)).toEqual([...APP_THEME_IDS])
    for (const theme of APP_THEMES) {
      for (const version of VERSIONS) {
        expect(Object.keys(theme[version]).sort(), `${theme.id} ${version}`).toEqual(
          [...APP_THEME_TOKENS].sort()
        )
        for (const token of APP_THEME_TOKENS) expect(theme[version][token]).toMatch(/\S/)
      }
    }
  })

  it("keeps Default's tokens equal to the app stylesheet's dark and light blocks", () => {
    const blocks = stylesheetBlocks()
    for (const version of VERSIONS) {
      const expected = Object.fromEntries(
        APP_THEME_TOKENS.map((token) => [token, blocks[version][token]])
      )
      expect(appThemeTokens('default', version)).toEqual(expected)
    }
  })

  it('leaves the agent and running colours to the tokens, so a theme reaches them', () => {
    const css = stylesheet()
    const kinds = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'custom']
    for (const kind of kinds) {
      const rule = new RegExp(
        `\\[data-kind='${kind}'\\]\\s*\\{\\s*--kind:\\s*var\\(--kind-${kind}\\);\\s*\\}`,
        'g'
      )
      expect(css.match(rule), kind).toHaveLength(1)
    }
    // No other `--kind:` declaration than those six.
    expect(css.match(/--kind:/g)).toHaveLength(kinds.length)
    // The running green only as the dark block's token: nowhere outside the two :root blocks.
    const outside = css
      .replace(/^:root\s*\{[^}]*\}/m, '')
      .replace(/@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{[^}]*\}\s*\}/, '')
    expect(outside).not.toMatch(/#3fb950/i)
  })

  it("gives Pi's kind a colour of its own in every version (#65 D4)", () => {
    const others = [
      'kind-claude',
      'kind-codex',
      'kind-gemini',
      'kind-opencode',
      'kind-custom'
    ] as const
    for (const theme of APP_THEMES) {
      for (const version of VERSIONS) {
        const t = theme[version]
        expect(t['kind-pi'], `${theme.id} ${version}`).toMatch(/^#[0-9a-f]{6}$/i)
        for (const other of others) {
          expect(t['kind-pi'].toLowerCase(), `${theme.id} ${version} ${other}`).not.toBe(
            t[other].toLowerCase()
          )
        }
      }
    }
  })

  it('gives Bikube dark its #17140F background and #F5B82E accent, Default light #1a7f37 running', () => {
    expect(appThemeTokens('bikube', 'dark').bg.toLowerCase()).toBe('#17140f')
    expect(appThemeTokens('bikube', 'dark').accent.toLowerCase()).toBe('#f5b82e')
    expect(appThemeTokens('default', 'light').running).toBe('#1a7f37')
    expect(appThemeTokens('default', 'dark').running).toBe('#3fb950')
  })
})

describe('contrast in every version (#64 D5, AC1)', () => {
  /** The surfaces Default dark's danger fails as text on today (D5's named exception). */
  const DEFAULT_DARK_DANGER_AS_TEXT: readonly string[] = ['card', 'surface', 'surface-raised']

  it('measures as WCAG does', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#e5484d')).toBeCloseTo(3.91, 2)
  })

  /** Every ratio below its minimum, as `<what> <ratio>`. */
  function failures(id: string, version: 'dark' | 'light', t: AppThemeTokens): string[] {
    const out: string[] = []
    const need = (what: string, fg: string, bg: string, min: number): void => {
      const ratio = contrastRatio(fg, bg)
      if (ratio < min) out.push(`${id} ${version}: ${what} ${ratio.toFixed(2)} < ${min}`)
    }
    const textBackgrounds = ['bg', 'column', 'card', 'surface', 'surface-raised'] as const
    for (const text of ['text', 'text-muted'] as const) {
      for (const bg of textBackgrounds) need(`${text} on ${bg}`, t[text], t[bg], 4.5)
    }
    need('text-muted on chip', t['text-muted'], t.chip, 4.5)
    // Agent setup (#68 D7): a dimmed Overview card hovered, the selected section tab and its count
    // on the accent tint over the section list, and the amber warnings and chips on a row.
    need('text-muted on surface-hover', t['text-muted'], t['surface-hover'], 4.5)
    const selectedTab = composite(t['accent-soft'], t.surface)
    need('text on accent-soft over surface', t.text, selectedTab, 4.5)
    need('pill-question-text on surface', t['pill-question-text'], t.surface, 4.5)
    // The Agent tab's expanded command (#75 D10): quoted strings in the waiting green on the panel.
    need('pill-waiting-text on surface', t['pill-waiting-text'], t.surface, 4.5)
    for (const bg of ['bg', 'card', 'surface'] as const) need(`accent on ${bg}`, t.accent, t[bg], 3)
    need('accent-text on accent', t['accent-text'], t.accent, 4.5)
    // D5's one named exception: Default dark's danger text, #ffffff on #e5484d, as it is today.
    if (!(id === 'default' && version === 'dark')) {
      need('danger-text on danger', t['danger-text'], t.danger, 4.5)
    }
    // Danger as text (error lines) on the surfaces; D5's other named exception is Default dark's,
    // as it is today, on exactly the surfaces it fails.
    for (const bg of ['bg', 'card', 'surface', 'surface-raised'] as const) {
      if (id === 'default' && version === 'dark' && DEFAULT_DARK_DANGER_AS_TEXT.includes(bg)) {
        continue
      }
      need(`danger on ${bg}`, t.danger, t[bg], 4.5)
    }
    for (const pill of ['working', 'waiting', 'question'] as const) {
      const bg = composite(t[`pill-${pill}-bg`], t.card)
      need(`pill-${pill}-text on its pill`, t[`pill-${pill}-text`], bg, 4.5)
    }
    const marks = [
      'running',
      'kind-claude',
      'kind-codex',
      'kind-gemini',
      'kind-opencode',
      'kind-pi',
      'kind-custom'
    ] as const
    for (const mark of marks) {
      for (const bg of ['card', 'surface'] as const) need(`${mark} on ${bg}`, t[mark], t[bg], 3)
    }
    return out
  }

  it('holds every D5 ratio for all 12 versions but Default dark danger text and danger as text', () => {
    const all = APP_THEMES.flatMap((theme) =>
      VERSIONS.flatMap((version) => failures(theme.id, version, theme[version]))
    )
    expect(all).toEqual([])
  })

  it("keeps the exceptions to Default dark's danger text and danger as text alone", () => {
    const t = appThemeTokens('default', 'dark')
    expect([t['danger-text'], t.danger]).toEqual(['#ffffff', '#e5484d'])
    // Exactly the surfaces it fails on today, so the exception can't cover a passing one.
    const failing = (['bg', 'card', 'surface', 'surface-raised'] as const).filter(
      (bg) => contrastRatio(t.danger, t[bg]) < 4.5
    )
    expect(failing).toEqual([...DEFAULT_DARK_DANGER_AS_TEXT])
  })
})

describe('windowBackground (#64 D7, AC5)', () => {
  it("is the picked theme's background for the resolved version", () => {
    expect(windowBackground('bikube', 'dark').toLowerCase()).toBe('#17140f')
    expect(windowBackground('default', 'dark')).toBe('#14151a')
    expect(windowBackground('default', 'light')).toBe('#f6f7f9')
    expect(windowBackground('catppuccin', 'light')).toBe('#eff1f5')
  })
})

describe('appThemeStylesheet (#64 D7)', () => {
  it("sets the dark version on :root and the light one under a light colour scheme, over main.css's :root", () => {
    const css = appThemeStylesheet('nord')
    const [dark, light] = css.split('@media (prefers-color-scheme: light)')
    expect(dark).toMatch(/^:root:root \{/)
    expect(declarations(dark)).toEqual(appThemeTokens('nord', 'dark'))
    expect(light).toMatch(/^ \{ :root:root \{/)
    expect(declarations(light)).toEqual(appThemeTokens('nord', 'light'))
  })
})

describe('the app theme launch argument (#64 D7)', () => {
  it('round-trips every theme id', () => {
    for (const id of APP_THEME_IDS) {
      expect(parseAppThemeArg(['electron', appThemeArg(id)])).toBe(id)
    }
  })

  it('reads Default with none or an unknown one', () => {
    expect(parseAppThemeArg(['electron'])).toBe('default')
    expect(parseAppThemeArg([appThemeArg('nord').replace('nord', 'solarized')])).toBe('default')
  })
})
