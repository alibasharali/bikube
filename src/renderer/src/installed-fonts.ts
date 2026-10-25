import { APP_FONT_CHOICES } from '../../core/app-fonts'
import { FONT_CHOICES } from '../../core/font-choices'

const SAMPLE = 'mmmmmmmmmmlli1WWwQ@#'

/**
 * Which of `names` are installed here: a font is there when text in it, falling back to a generic
 * family, measures differently from the generic family alone (for either baseline, since the
 * font may be the generic one). Measured synchronously; no permission needed.
 */
function measureInstalled(
  names: readonly string[],
  baselines: readonly string[]
): ReadonlySet<string> {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return new Set()
  const width = (font: string): number => {
    context.font = `72px ${font}`
    return context.measureText(SAMPLE).width
  }
  const base = baselines.map(width)
  return new Set(
    names.filter((name) =>
      baselines.some((generic, i) => width(`"${name}", ${generic}`) !== base[i])
    )
  )
}

let installed: ReadonlySet<string> | undefined
let installedApp: ReadonlySet<string> | undefined

/** The listed coding fonts installed here, for Font family; measured once. */
export function installedFonts(): ReadonlySet<string> {
  return (installed ??= measureInstalled(FONT_CHOICES, ['monospace', 'serif']))
}

/** The listed UI fonts installed here, for App font (#66 D7); measured once. */
export function installedAppFonts(): ReadonlySet<string> {
  return (installedApp ??= measureInstalled(APP_FONT_CHOICES, ['sans-serif', 'serif']))
}
