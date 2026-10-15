/**
 * The Claude settings file Drovr gives every Claude Code card (#31 D14, D15, D16): hooks that set
 * the calling card's activity with `board activity`, and a session start hook that tells Claude
 * to keep a one-line `board status`. The same text ships as `resources/bin/claude-settings.json`
 * and `resources/bin/claude-instruction.txt` (a test keeps them equal) and is written beside the
 * remote `board` in SSH cards. Plain TS.
 */
import type { Activity } from './activity'

/** The settings file's name in Drovr's bin directory and in an SSH session's directory. */
export const CLAUDE_SETTINGS_FILE = 'claude-settings.json'

/** The instruction's file, beside the settings file: kept apart so it needs no JSON escaping. */
export const CLAUDE_INSTRUCTION_FILE = 'claude-instruction.txt'

/** D16, verbatim. No backslash, so the SSH copy stays fish-safe. */
export const CLAUDE_INSTRUCTION =
  'You are running inside a Drovr card, a kanban board card that shows your status. ' +
  `At the end of every turn, run: "$DROVR_BIN/board" status . '<one line>' — one short line, ` +
  'at most 80 characters, saying what you did or what you are waiting for, for example: ' +
  "Tests green, PR ready for review. Do it silently: don't mention it to the user. " +
  'If the command fails, ignore it.'

/** Every hook: a silent `board` call that never fails (D15). */
const TIMEOUT = 5

/** Sets the calling card's activity, output discarded, exit 0 whatever happens. */
const activity = (value: Activity | '$a'): string =>
  `"$DROVR_BIN/board" activity . ${value} >/dev/null 2>&1; exit 0`

/**
 * `PreToolUse` fires for every tool: `question` for `AskUserQuestion` (Claude asking the user),
 * else `working`. A matcher can't say "every tool but one" without two hooks racing, so the one
 * command reads the tool's name from its JSON input in plain sh. Inside the input every string's
 * `"` is escaped, so only the real `tool_name` key can match. `board` runs in the background with
 * every stream detached, so Claude never waits for it before a tool (round 4 Q5).
 */
const PRE_TOOL_USE =
  `a=working; case $(cat) in *'"tool_name":"AskUserQuestion"'*|*'"tool_name": "AskUserQuestion"'*) ` +
  `a=question;; esac; "$DROVR_BIN/board" activity . $a </dev/null >/dev/null 2>&1 & exit 0`

/** Prints the instruction, which Claude adds to its context; sets nothing. */
const SESSION_START = `cat "$DROVR_BIN/${CLAUDE_INSTRUCTION_FILE}" 2>/dev/null; exit 0`

const group = (command: string, matcher?: string): object => ({
  ...(matcher === undefined ? {} : { matcher }),
  hooks: [{ type: 'command', command, timeout: TIMEOUT }]
})

/** The settings file's text: only hooks (D15). */
export function claudeSettings(): string {
  const settings = {
    hooks: {
      SessionStart: [group(SESSION_START)],
      UserPromptSubmit: [group(activity('working'))],
      PreToolUse: [group(PRE_TOOL_USE, '*')],
      // A permission prompt or an input request, not the idle reminder.
      Notification: [group(activity('question'), 'permission_prompt|elicitation_dialog')],
      Stop: [group(activity('waiting'))]
    }
  }
  return `${JSON.stringify(settings, null, 2)}\n`
}
