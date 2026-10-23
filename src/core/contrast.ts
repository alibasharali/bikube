/**
 * WCAG 2 contrast between two CSS colours (#64 D5). Plain TS with no Node or DOM imports.
 * Takes `#rgb`, `#rrggbb` and `rgb()`/`rgba()` with comma-separated values.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0 to 1. */
  a: number
}

/** `value` as channels 0 to 255 and alpha 0 to 1; throws on a colour it can't read. */
export function parseColor(value: string): Rgba {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1]
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1
    }
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    text
  )
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] ? Number(fn[4]) : 1 }
  }
  throw new Error(`not a colour: ${value}`)
}

/** `top` drawn over the opaque `bottom`, as `#rrggbb`. */
export function composite(top: string, bottom: string): string {
  const t = parseColor(top)
  const b = parseColor(bottom)
  const mix = (x: number, y: number): number => Math.round(x * t.a + y * (1 - t.a))
  return toHex({ r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), a: 1 })
}

function toHex({ r, g, b }: Rgba): string {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}

function luminance(color: string): number {
  const { r, g, b } = parseColor(color)
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** The contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
