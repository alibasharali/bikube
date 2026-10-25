import { ANSI_COLOUR_NAMES, type TerminalPalette } from '../../core/terminal-appearance'

type Colour = keyof TerminalPalette

/** One run of text in the preview: its colour and whether it is bold. */
type Run = [text: string, colour?: Colour, bold?: boolean]

const PROMPT: Run[] = [
  ['~/Repos/bikube', 'blue', true],
  [' on ', 'foreground'],
  [' main', 'magenta', true],
  [' [!?]', 'red'],
  [' via ', 'foreground'],
  [' v22', 'green', true],
  ['\n❯ ', 'green', true]
]

/** A short made-up session using every ANSI colour the way common tools do. */
const SESSION: Run[][] = [
  [...PROMPT, ['ls -l', 'foreground']],
  [
    ['drwxr-xr-x  '],
    ['src/', 'blue', true],
    ['        '],
    ['-rwxr-xr-x  '],
    ['build.sh', 'green', true]
  ],
  [['lrwxr-xr-x  '], ['logs', 'cyan', true], [' -> /var/log  '], ['-rw-r--r--  '], ['README.md']],
  [...PROMPT, ['git status --short', 'foreground']],
  [
    [' M ', 'red'],
    ['src/app.ts    '],
    ['A  ', 'green'],
    ['src/theme.ts    '],
    ['?? ', 'red'],
    ['notes.md']
  ],
  [...PROMPT, ['npm test', 'foreground']],
  [
    [' ✓ ', 'green'],
    ['128 passed  '],
    ['✗ ', 'red'],
    ['2 failed  '],
    ['⚠ ', 'yellow'],
    ['3 skipped  '],
    ['(1.42s)', 'brightBlack']
  ],
  [
    ['  at ', 'brightBlack'],
    ['parseTheme ', 'brightCyan'],
    ['(', 'brightBlack'],
    ['src/theme.ts:42:7', 'brightYellow'],
    [')', 'brightBlack']
  ]
]

/** Bold runs: heavier than any Font weight the settings offer, as in the terminals. */
const BOLD = 700

/**
 * A made-up terminal in `palette`'s colours, for the theme picker and Settings' Terminal section:
 * a prompt, `ls`, `git` and test output, the 16 ANSI colours, a selection and the cursor. The font
 * props left out keep the preview's own look.
 */
function TerminalPreview({
  palette,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing
}: {
  palette: Readonly<TerminalPalette>
  fontFamily: string
  /** The terminals' font size; the preview's own size when left out. */
  fontSize?: number
  /** The terminals' font weight (bold runs stay bold). */
  fontWeight?: number
  /** The terminals' line height, a multiple of the font size. */
  lineHeight?: number
  /** The terminals' letter spacing, in px. */
  letterSpacing?: number
}): React.JSX.Element {
  const colour = (name: Colour | undefined): string | undefined =>
    name === undefined ? undefined : palette[name]
  return (
    <div
      className="terminal-preview"
      data-testid="theme-preview"
      data-background={palette.background}
      style={{
        background: palette.background,
        color: palette.foreground,
        fontFamily,
        fontSize,
        fontWeight,
        // In px when the size is known, so it is exactly that multiple of the terminals' size.
        lineHeight:
          lineHeight !== undefined && fontSize !== undefined
            ? `${lineHeight * fontSize}px`
            : lineHeight,
        letterSpacing: letterSpacing === undefined ? undefined : `${letterSpacing}px`
      }}
      aria-hidden="true"
    >
      {SESSION.map((line, i) => (
        <div key={i} className="terminal-preview-line">
          {line.map(([text, name, bold], j) => (
            <span key={j} style={{ color: colour(name), fontWeight: bold ? BOLD : undefined }}>
              {text}
            </span>
          ))}
        </div>
      ))}
      {[0, 8].map((start) => (
        <div key={start} className="terminal-preview-swatches">
          {ANSI_COLOUR_NAMES.slice(start, start + 8).map((name) => (
            <span key={name} title={name} style={{ background: palette[name] }} />
          ))}
        </div>
      ))}
      <div className="terminal-preview-line">
        <span
          style={{
            background: palette.selectionBackground,
            color: palette.selectionForeground ?? palette.foreground
          }}
        >
          selected text
        </span>
      </div>
      <div className="terminal-preview-line">
        {PROMPT.map(([text, name, bold], j) => (
          <span key={j} style={{ color: colour(name), fontWeight: bold ? BOLD : undefined }}>
            {text}
          </span>
        ))}
        <span style={{ background: palette.cursor, color: palette.cursorAccent }}> </span>
      </div>
    </div>
  )
}

export default TerminalPreview
