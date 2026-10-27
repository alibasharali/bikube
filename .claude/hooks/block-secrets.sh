#!/usr/bin/env bash
# PreToolUse (Bash): blocks commands that touch secret files. The Read deny rules in
# settings.json don't cover `cat`/`grep` in Bash, hence this hook. No jq: not every sandbox has it.
input=$(cat)
# example files are fine to read
scrubbed=$(printf '%s' "$input" | sed -E 's/\.(env|dev\.vars)\.example//g')

if printf '%s' "$scrubbed" | grep -Eq '(^|[^A-Za-z0-9_])\.(env|dev\.vars)(\.[A-Za-z0-9_-]+)?([^A-Za-z0-9_.-]|$)'; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by .claude/hooks/block-secrets.sh: the command touches a secrets file (.env*, .dev.vars*). Never read these; ask the developer for a value if you need one. To create a missing local env file from its committed example (to run the app), run .claude/local-env.sh. If the path is only mentioned in text (commit message, PR body), write the text to a file and pass it with -F / --body-file."}}
JSON
fi
exit 0
