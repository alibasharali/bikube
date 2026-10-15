import { FONT_CHOICES } from '../../core/font-choices'

const SAMPLE = 'mmmmmmmmmmlli1WWwQ@#'
const BASELINES = ['monospace', 'serif'] as const

let installed: ReadonlySet<string> | undefined

/**
 * The listed fonts installed here: a font is there when text in it, falling back to a generic
 * family, measures differently from the generic family alone (for either baseline, since the
 * font may be the generic one). Measured once, synchronously; no permission needed.
 */
export function installedFonts(): ReadonlySet<string> {
  if (installed) return installed
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return (installed = new Set())
  const width = (font: string): number => {
    context.font = `72px ${font}`
    return context.measureText(SAMPLE).width
  }
  const base = BASELINES.map(width)
  installed = new Set(
    FONT_CHOICES.filter((name) =>
      BASELINES.some((generic, i) => width(`"${name}", ${generic}`) !== base[i])
    )
  )
  return installed
}
