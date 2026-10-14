#!/usr/bin/env bash
# Stop: the agent may not finish with red checks. Runs the project's .claude/check.sh, only
# when the working tree changed since the last green run, so chat turns don't cost a build.
input=$(cat)

# a worker (subagent, workflow, teammate) still running in the background may be mid-edit:
# leave the tree alone; its report wakes the agent and the next stop runs the checks.
# Running shell/monitor tasks (a dev server, a watcher) don't count. Anything unparseable
# runs the checks.
worker_running() {
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e '
      const t = JSON.parse(require("fs").readFileSync(0, "utf8")).background_tasks
      const busy = Array.isArray(t) && t.some((x) =>
        x && ["subagent", "workflow", "teammate"].includes(x.type) && x.status === "running")
      process.exit(busy ? 0 : 1)' 2>/dev/null
    return
  fi
  # no node: a rougher match, limited to the background_tasks array
  printf '%s' "$input" | LC_ALL=C tr '\n' ' ' \
    | LC_ALL=C sed -n 's/^.*"background_tasks"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*$/\1/p' \
    | LC_ALL=C tr '{}' '\n\n' \
    | LC_ALL=C grep -E '"type"[[:space:]]*:[[:space:]]*"(subagent|workflow|teammate)"' \
    | LC_ALL=C grep -Eq '"status"[[:space:]]*:[[:space:]]*"running"'
}
worker_running && exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$root" || exit 0
[ -x .claude/check.sh ] || exit 0

changed=$(git status --porcelain --untracked-files=all)
[ -z "$changed" ] && exit 0

hash=$( { git diff HEAD 2>/dev/null; git ls-files --others --exclude-standard -z | xargs -0 cat 2>/dev/null; } | cksum | cut -d' ' -f1)
cache="${TMPDIR:-/tmp}/claude-stop-checks-$(printf '%s' "$root" | cksum | cut -d' ' -f1)"
[ "$(cat "$cache" 2>/dev/null)" = "$hash" ] && exit 0

log=$(mktemp)
if .claude/check.sh >"$log" 2>&1; then
  echo "$hash" >"$cache"
  rm -f "$log"
  exit 0
fi

# json-escape the tail of the log for the reason field
details=$(tail -25 "$log" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/  /g' | awk '{printf "%s\\n", $0}')
rm -f "$log"

# second stop in a row: don't trap the agent in a loop, tell the user instead
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  printf '{"systemMessage":"Checks are still red after one attempt to fix them.\\n%s"}\n' "$details"
  exit 0
fi

waiting="If a worker you dispatched is still running, don't touch the tree: end your turn saying you're waiting for it."
printf '{"decision":"block","reason":"`.claude/check.sh` is red. Fix it before you finish. Never change a test to make it pass. %s\\n%s"}\n' "$waiting" "$details"
exit 0
