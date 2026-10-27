/**
 * Agent resume presets (#21 D1): the one place their commands live. Each has a plain command,
 * typed the first time a card starts it, and a resume command picking the agent's latest session
 * in the current directory (D2). Constants only: nothing from a card is interpolated (D8).
 * Plain TS: no Electron or Node imports.
 */

export interface AgentPreset {
  /** The select's label (#21 D5) and the tag's tooltip. */
  label: string
  /** Shown on the card on the board (#21 D5). */
  tag: string
  plain: string
  resume: string
  /** How its plain command takes a first prompt (#69 D2): the option before it, '' for none. */
  promptFlag: string
}

export const AGENT_PRESETS = {
  codex: {
    label: 'Codex',
    tag: 'Codex',
    plain: 'codex',
    resume: 'codex resume --last',
    promptFlag: ''
  },
  gemini: {
    label: 'Gemini CLI',
    tag: 'Gemini',
    plain: 'gemini',
    resume: 'gemini --resume latest',
    promptFlag: '-i'
  },
  opencode: {
    label: 'OpenCode',
    tag: 'OpenCode',
    plain: 'opencode',
    resume: 'opencode --continue',
    promptFlag: '--prompt'
  },
  pi: { label: 'Pi', tag: 'Pi', plain: 'pi', resume: 'pi --continue', promptFlag: '' }
} as const satisfies Record<string, AgentPreset>

export type AgentKind = keyof typeof AGENT_PRESETS

/** The preset kinds in select order (#21 D5). */
export const AGENT_KINDS: readonly AgentKind[] = ['codex', 'gemini', 'opencode', 'pi']

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value)
}
