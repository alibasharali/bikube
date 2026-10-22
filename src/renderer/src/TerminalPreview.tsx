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

/**
 * A made-up terminal in `palette`'s colours, for the theme picker: a prompt, `ls`, `git` and test
 * output, the 16 ANSI colours, a selection and the cursor.
 */
function TerminalPreview({
  palette,
  fontFamily,
  fontSize
}: {
  palette: Readonly<TerminalPalette>
  fontFamily: string
  /** The terminals' font size; the preview's own size when left out. */
  fontSize?: number
}): React.JSX.Element {
  const colour = (name: Colour | undefined): string | undefined =>
    name === undefined ? undefined : palette[name]
  return (
    <div
      className="terminal-preview"
      data-testid="theme-preview"
      data-background={palette.background}
      style={{ background: palette.background, color: palette.foreground, fontFamily, fontSize }}
      aria-hidden="true"
    >
      {SESSION.map((line, i) => (
        <div key={i} className="terminal-preview-line">
          {line.map(([text, name, bold], j) => (
            <span key={j} style={{ color: colour(name), fontWeight: bold ? 700 : undefined }}>
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
          <span key={j} style={{ color: colour(name), fontWeight: bold ? 700 : undefined }}>
            {text}
          </span>
        ))}
        <span style={{ background: palette.cursor, color: palette.cursorAccent }}> </span>
      </div>
    </div>
  )
}

export default TerminalPreview
