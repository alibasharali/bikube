import { describe, expect, it } from 'vitest'
import { commandSteps, type CommandStep } from './command-layout'

/** Each step as its line: the operator, a space, then the step's text. */
const lines = (command: string): string[] =>
  commandSteps(command).map((s) =>
    s.operator
      ? `${s.operator} ${s.parts.map((p) => p.text).join('')}`
      : s.parts.map((p) => p.text).join('')
  )

const kinds = (step: CommandStep): [string, string][] =>
  step.parts.filter((p) => p.text.trim() !== '').map((p) => [p.text, p.kind])

describe("the Commands group's command layout (#75 D10)", () => {
  it('puts each top-level step on its own line with its operator first, cd dimmed', () => {
    const steps = commandSteps('cd /repo && npm test | tail -5')
    expect(lines('cd /repo && npm test | tail -5')).toEqual([
      'cd /repo',
      '&& npm test',
      '| tail -5'
    ])
    expect(steps.map((s) => s.dim)).toEqual([true, false, false])
  })

  it('splits at ||, ; and top-level newlines too', () => {
    expect(lines('make || echo failed; ls -la\npwd')).toEqual([
      'make',
      '|| echo failed',
      '; ls -la',
      'pwd'
    ])
  })

  it('never splits inside quotes, $(…), backticks or a subshell', () => {
    expect(lines(`echo "a && b; c | d" 'e || f' && echo $(git log | head -1; echo x)`)).toEqual([
      `echo "a && b; c | d" 'e || f'`,
      '&& echo $(git log | head -1; echo x)'
    ])
    expect(lines('echo `ls | wc -l` | cat')).toEqual(['echo `ls | wc -l`', '| cat'])
    expect(lines('(cd a && make) && echo "it said \\"x; y\\""')).toEqual([
      '(cd a && make)',
      '&& echo "it said \\"x; y\\""'
    ])
  })

  it("never splits inside a heredoc's body", () => {
    const command = "git commit -F - <<'EOF'\nFix: a && b\nc | d; e\nEOF\n&& git push"
    expect(lines(command)).toEqual([
      "git commit -F - <<'EOF'\nFix: a && b\nc | d; e\nEOF\n",
      '&& git push'
    ])
    expect(lines('cat <<-END | wc -l\n\tx; y\n\tEND\necho done')).toEqual([
      'cat <<-END',
      '| wc -l\n\tx; y\n\tEND\n',
      'echo done'
    ])
  })

  it('classifies the program, flags, strings and the rest', () => {
    const [step] = commandSteps(`FOO=1 git commit -m "fix it" --amend 'x' > out.txt`)
    expect(kinds(step)).toEqual([
      ['FOO=1', 'other'],
      ['git', 'program'],
      ['commit', 'other'],
      ['-m', 'flag'],
      ['"fix it"', 'string'],
      ['--amend', 'flag'],
      ["'x'", 'string'],
      ['>', 'other'],
      ['out.txt', 'other']
    ])
  })

  it('ends an unterminated quote or substitution at the end of the command', () => {
    expect(lines('echo "open && x')).toEqual(['echo "open && x'])
    expect(lines('echo $(open && x')).toEqual(['echo $(open && x'])
    expect(lines('')).toEqual([])
  })
})
