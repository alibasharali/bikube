#!/usr/bin/env bash
# Creates each gitignored local env file (.dev.vars, .env, in any folder) from the tracked *.example next to it,
# so agents can start the app (in its mock mode, where the example turns it on) without touching secrets.
# Never reads, prints or overwrites an existing env file; refuses, writing nothing, when a target isn't gitignored.
# Its command line names no env file, so block-secrets.sh lets it through.
set -eu
cd "$(git rev-parse --show-toplevel)"

examples=()
while IFS= read -r ex; do examples+=("$ex"); done < <(git ls-files -- '.dev.vars.example' '*/.dev.vars.example' '.env.example' '*/.env.example')
if [ "${#examples[@]}" -eq 0 ]; then
  echo "no tracked .dev.vars.example or .env.example: nothing to create"
  exit 0
fi

# check every target before copying any, so a refusal writes nothing
refused=0
for ex in "${examples[@]}"; do
  target="${ex%.example}"
  { [ -e "$target" ] || [ -L "$target" ]; } && continue
  if ! git check-ignore -q -- "$target"; then
    echo "$target is not gitignored: add it to .gitignore, then run .claude/local-env.sh again" >&2
    refused=1
  fi
done
[ "$refused" -eq 0 ] || exit 1

for ex in "${examples[@]}"; do
  target="${ex%.example}"
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "$target exists: left as is"
  else
    cp -- "$ex" "$target"
    echo "created $target from $ex"
  fi
done
