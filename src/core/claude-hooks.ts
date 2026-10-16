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

/**
 * D16. No backslash, so the SSH copy stays fish-safe. The command is to be run as given: a card's
 * `$SHELL` may be fish while Claude's tool runs another shell, so anything added to it (`|| true`,
 * `; or true`, redirections) can break it, and a failure needs no handling.
 */
export const CLAUDE_INSTRUCTION =
  'You are running inside a Drovr card, a kanban board card that shows your status. ' +
  `At the end of every turn, run exactly: "$DROVR_BIN/board" status . '<one line>' — one short ` +
  'line, at most 80 characters, saying what you did or what you are waiting for, for example: ' +
  'Tests green, PR ready for review. Run that command alone, as written: add nothing before or ' +
  "after it (no redirection, no || true, no ; or true). Do it silently: don't mention it to the " +
  'user. If it fails, ignore it and move on.'

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

/**
 * Reports the session in the hook's input to Drovr (`board session`), which the card resumes from
 * then on. The id is cut out of the JSON with parameter expansion: no backslash, no tool.
 */
const REPORT_SESSION =
  'i=${s#*\'"session_id":"\'}; [ "$i" = "$s" ] && i=${s#*\'"session_id": "\'}; i=${i%%\'"\'*}; ' +
  '"$DROVR_BIN/board" session . "$i" >/dev/null 2>&1'

/**
 * Prints the instruction, which Claude adds to its context, unless the card was started with
 * `DROVR_CLAUDE_STATUS=0` (the Claude Code status updates setting off). A `/resume` reports the
 * resumed session, so the card resumes it next time.
 */
const SESSION_START =
  `s=$(cat); case $s in *'"source":"resume"'*|*'"source": "resume"'*) ${REPORT_SESSION};; esac; ` +
  `[ "$DROVR_CLAUDE_STATUS" = 0 ] || cat "$DROVR_BIN/${CLAUDE_INSTRUCTION_FILE}" 2>/dev/null; ` +
  'exit 0'

/** A message sent: the card has a conversation to resume (reported), and Claude is working. */
const USER_PROMPT_SUBMIT = `s=$(cat); ${REPORT_SESSION}; "$DROVR_BIN/board" activity . working >/dev/null 2>&1; exit 0`

const group = (command: string, matcher?: string): object => ({
  ...(matcher === undefined ? {} : { matcher }),
  hooks: [{ type: 'command', command, timeout: TIMEOUT }]
})

/** The settings file's text: only hooks (D15). */
export function claudeSettings(): string {
  const settings = {
    hooks: {
      SessionStart: [group(SESSION_START)],
      UserPromptSubmit: [group(USER_PROMPT_SUBMIT)],
      PreToolUse: [group(PRE_TOOL_USE, '*')],
      // A permission prompt or an input request, not the idle reminder.
      Notification: [group(activity('question'), 'permission_prompt|elicitation_dialog')],
      Stop: [group(activity('waiting'))]
    }
  }
  return `${JSON.stringify(settings, null, 2)}\n`
}
