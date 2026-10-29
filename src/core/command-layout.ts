/**
 * A command laid out for the Agent tab's expanded Commands row (#75 D10): split at the top-level
 * `&&`, `||`, `;`, `|` and newlines, never inside quotes, `$(…)`, backticks, a subshell or a
 * heredoc; each step's words classified for colouring, and `cd <dir>` steps marked to be dimmed.
 * A display aid only: nothing here runs or rewrites the command. No Node or DOM imports.
 */

export type StepOperator = '&&' | '||' | ';' | '|'

export type PartKind = 'program' | 'flag' | 'string' | 'other'

export interface CommandPart {
  /** The text as written, whitespace parts included, so the parts join back to the step. */
  text: string
  kind: PartKind
}

export interface CommandStep {
  /** The operator that starts its line; null for the first step and one after a newline. */
  operator: StepOperator | null
  parts: CommandPart[]
  /** A `cd <dir>` step, shown dimmed. */
  dim: boolean
}

type Token =
  | { type: 'word'; text: string }
  | { type: 'space'; text: string }
  | { type: 'op'; text: StepOperator }
  | { type: 'newline' }
  | { type: 'heredoc'; text: string }

const isSpace = (c: string): boolean => c === ' ' || c === '\t'
const stops = (c: string): boolean =>
  isSpace(c) || c === '\n' || c === ';' || c === '|' || c === '&'

/** The index after the quote opened at `from` (or the end when it never closes). */
function skipQuote(s: string, from: number): number {
  const quote = s[from]
  let i = from + 1
  while (i < s.length) {
    if (quote !== "'" && s[i] === '\\') i += 2
    else if (s[i] === quote) return i + 1
    else if (quote === '"' && s[i] === '$' && s[i + 1] === '(') i = skipParens(s, i + 1)
    else i++
  }
  return s.length
}

/** The index after the `(` at `from` is closed, quotes and nesting respected. */
function skipParens(s: string, from: number): number {
  let depth = 0
  let i = from
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') i += 2
    else if (c === "'" || c === '"' || c === '`') i = skipQuote(s, i)
    else {
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) return i + 1
      i++
    }
  }
  return s.length
}

/** A heredoc's delimiter after `<<` or `<<-` at `from`: its word unquoted, and where it ends. */
function heredocWord(s: string, from: number): { delimiter: string; end: number } | null {
  let i = from
  while (i < s.length && isSpace(s[i])) i++
  const start = i
  while (i < s.length && !stops(s[i]) && s[i] !== '<' && s[i] !== '>') {
    i = s[i] === "'" || s[i] === '"' ? skipQuote(s, i) : i + 1
  }
  const delimiter = s.slice(start, i).replace(/['"\\]/g, '')
  return delimiter === '' ? null : { delimiter, end: i }
}

function tokenize(s: string): Token[] {
  const tokens: Token[] = []
  const heredocs: { delimiter: string; dash: boolean }[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (isSpace(c)) {
      const start = i
      while (i < s.length && isSpace(s[i])) i++
      tokens.push({ type: 'space', text: s.slice(start, i) })
    } else if (c === '\n') {
      if (heredocs.length === 0) {
        tokens.push({ type: 'newline' })
        i++
        continue
      }
      // The bodies of the heredocs opened on this line, each up to its delimiter's line.
      const start = i
      i++
      for (const { delimiter, dash } of heredocs.splice(0)) {
        while (i < s.length) {
          const lineEnd = s.indexOf('\n', i)
          const end = lineEnd === -1 ? s.length : lineEnd
          const line = s.slice(i, end)
          i = lineEnd === -1 ? s.length : lineEnd + 1
          if ((dash ? line.replace(/^\t+/, '') : line) === delimiter) break
        }
      }
      tokens.push({ type: 'heredoc', text: s.slice(start, i) })
    } else if ((c === '&' || c === '|') && s[i + 1] === c) {
      tokens.push({ type: 'op', text: c === '&' ? '&&' : '||' })
      i += 2
    } else if (c === ';' || c === '|') {
      tokens.push({ type: 'op', text: c })
      i += c === '|' && s[i + 1] === '&' ? 2 : 1
    } else if (c === '&') {
      tokens.push({ type: 'word', text: '&' })
      i++
    } else if (c === '#' && (i === 0 || isSpace(s[i - 1]) || s[i - 1] === '\n')) {
      const end = s.indexOf('\n', i)
      tokens.push({ type: 'word', text: s.slice(i, end === -1 ? s.length : end) })
      i = end === -1 ? s.length : end
    } else if (c === '(') {
      const end = skipParens(s, i)
      tokens.push({ type: 'word', text: s.slice(i, end) })
      i = end
    } else {
      const start = i
      while (i < s.length && !stops(s[i])) {
        const d = s[i]
        if (d === '\\') i += 2
        else if (d === "'" || d === '"' || d === '`') i = skipQuote(s, i)
        else if (d === '$' && s[i + 1] === '(') i = skipParens(s, i + 1)
        else if (d === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
          const dash = s[i + 2] === '-'
          const word = heredocWord(s, i + (dash ? 3 : 2))
          if (word) {
            heredocs.push({ delimiter: word.delimiter, dash })
            i = word.end
          } else i += 2
        } else i++
      }
      tokens.push({ type: 'word', text: s.slice(start, Math.min(i, s.length)) })
    }
  }
  return tokens
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function step(operator: StepOperator | null, tokens: Token[]): CommandStep | null {
  while (tokens.length > 0 && tokens[0].type === 'space') tokens.shift()
  while (tokens.length > 0 && tokens[tokens.length - 1].type === 'space') tokens.pop()
  if (tokens.length === 0) return null
  const parts: CommandPart[] = []
  let program: string | null = null
  for (const token of tokens) {
    if (token.type === 'space') parts.push({ text: token.text, kind: 'other' })
    else if (token.type === 'heredoc') parts.push({ text: token.text, kind: 'string' })
    else if (token.type === 'word') {
      const t = token.text
      let kind: PartKind = 'other'
      if (program === null && !ASSIGNMENT.test(t) && !/^[(<>&0-9]/.test(t)) {
        program = t
        kind = 'program'
      } else if (t.startsWith('-')) kind = 'flag'
      else if (/^(?:\$?'|")/.test(t)) kind = 'string'
      parts.push({ text: t, kind })
    }
  }
  return { operator, parts, dim: program === 'cd' }
}

/** `command`'s top-level steps in order (D10). */
export function commandSteps(command: string): CommandStep[] {
  const steps: CommandStep[] = []
  let operator: StepOperator | null = null
  let current: Token[] = []
  const end = (): void => {
    const made = step(operator, current)
    if (made) steps.push(made)
    current = []
  }
  for (const token of tokenize(command)) {
    if (token.type === 'op') {
      end()
      operator = token.text
    } else if (token.type === 'newline') {
      end()
      operator = null
    } else if (token.type === 'heredoc') {
      // A heredoc's body ends its line: what follows starts a new one.
      current.push(token)
      end()
      operator = null
    } else current.push(token)
  }
  end()
  return steps
}
