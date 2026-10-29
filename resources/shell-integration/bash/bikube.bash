# Bikube's shell integration for bash (#45 D3). Bikube starts bash as `bash --init-file <this>`
# instead of `bash -l` (which would ignore --init-file), so this first reads what a login shell
# reads, then marks each prompt and command for the terminal: OSC 133 A (prompt start),
# B (prompt end), C (command output start), D;<exit code> (command finished), and OSC 7 with the
# directory. Nothing else changes: the prompt, $? seen by the user's PROMPT_COMMAND and prompt,
# their DEBUG trap (run after Bikube's) and history are the user's. It also defines `claude`, adding
# Bikube's Claude Code settings (see below). With bash-preexec (starship,
# atuin), which owns the DEBUG trap and PROMPT_COMMAND, the marks go through its precmd_functions
# and preexec_functions instead, also when it is loaded after this. Safe under the user's `set -u`.
# Works on bash 3.2 (macOS's /bin/bash): no PS0, no ${var@Q}, no associative arrays, no declare -g.
# Bikube adds no variable for bash, so a nested bash is the user's plain one.

# What `bash -l` reads first: /etc/profile, then the first of these that exists.
if [ -r /etc/profile ]; then
  . /etc/profile
fi
if [ -r ~/.bash_profile ]; then
  . ~/.bash_profile
elif [ -r ~/.bash_login ]; then
  . ~/.bash_login
elif [ -r ~/.profile ]; then
  . ~/.profile
fi

if [[ $- == *i* ]] && [ -z "${__bikube_integration-}" ]; then
  __bikube_integration=1
  # The status of the command line the prompt follows.
  __bikube_status=0
  # Set once a command line started (its C sent), so its D follows at the next prompt.
  __bikube_ran=
  # Set at the end of PROMPT_COMMAND: the next DEBUG trap is the user's command line.
  __bikube_ready=
  # The user's PS1, and the same with Bikube's marks around it, as set for the prompt.
  __bikube_ps1=
  __bikube_ps1_marked=
  # The user's own DEBUG trap when this was loaded, run after Bikube's.
  __bikube_user_debug=
  # Set once the marks go through bash-preexec's hooks instead of Bikube's trap.
  __bikube_bp=
  # The command number (the prompt's \#) at the last prompt; empty before the first.
  __bikube_line_n=

  # Sets $? (and, through its last argument, $_) for whatever runs next.
  __bikube_return() {
    return "$1"
  }

  # OSC 7 with $PWD, every byte but [a-zA-Z0-9/._~-] percent-encoded. LC_ALL is C for the loop
  # (bytes, not characters) and put back explicitly afterwards, unset when it was unset.
  __bikube_cwd() {
    local had_lc_all=${LC_ALL+set} old_lc_all=${LC_ALL-}
    LC_ALL=C
    local path=$PWD out='' c n i=0
    while [ "$i" -lt "${#path}" ]; do
      c=${path:$i:1}
      case $c in
        [a-zA-Z0-9/._~-]) out=$out$c ;;
        *)
          printf -v n '%d' "'$c"
          printf -v c '%%%02X' "$((n & 255))"
          out=$out$c
          ;;
      esac
      i=$((i + 1))
    done
    if [ -n "$had_lc_all" ]; then
      LC_ALL=$old_lc_all
    else
      unset LC_ALL
    fi
    builtin printf '\033]7;file://%s%s\007' "$HOSTNAME" "$out"
  }

  # The command number into __bikube_line_n: it grows once per command line bash read, never for an
  # empty Enter, whatever history keeps. Read as the prompt's \# through ${…@P}, from bash 4.4;
  # before that (macOS's bash 3.2) there is none, and a whole-subshell line goes unmarked.
  if [ "${BASH_VERSINFO[0]}" -gt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -ge 4 ]; }; then
    __bikube_line_fmt='\#'
    eval '__bikube_line() { __bikube_line_n=${__bikube_line_fmt@P}; }'
  else
    __bikube_line() {
      :
    }
  fi

  # D for the command line that ran, if one did; $? is its status, given back. A line that is one
  # whole subshell `( … )` runs no simple command in this shell, so no DEBUG trap (nor
  # bash-preexec's preexec) sent its C: a new command number since the last prompt (bash 4.4+)
  # says it ran, and its C goes out here, late, before its D.
  __bikube_end() {
    __bikube_status=$?
    local before=$__bikube_line_n
    __bikube_line
    if [ -z "$__bikube_ran" ] && [ -n "$before" ] && [ "$__bikube_line_n" != "$before" ]; then
      __bikube_ran=1
      builtin printf '\033]133;C\007'
    fi
    if [ -n "$__bikube_ran" ]; then
      __bikube_ran=
      builtin printf '\033]133;D;%s\007' "$__bikube_status"
    fi
    return "$__bikube_status"
  }

  # A and B around whatever PS1 the user's commands left, and OSC 7.
  __bikube_mark_prompt() {
    if [ "$PS1" != "$__bikube_ps1_marked" ]; then
      __bikube_ps1=$PS1
      __bikube_ps1_marked='\[\033]133;A\007\]'$PS1'\[\033]133;B\007\]'
    fi
    PS1=$__bikube_ps1_marked
    __bikube_cwd
  }

  # C as the user's command line starts, with the user's own PS1 back while it runs.
  __bikube_start() {
    __bikube_ran=1
    PS1=$__bikube_ps1
    builtin printf '\033]133;C\007'
  }

  # bash-preexec is loaded and will run its hooks: its precmd_functions run at every prompt
  # (from its PROMPT_COMMAND, or the install line it adds there for the first prompt).
  __bikube_bp_present() {
    [ -n "${bash_preexec_imported-}${__bp_imported-}" ] || return 1
    case "${PROMPT_COMMAND[*]-}" in
      *__bp_precmd_invoke_cmd* | *__bp_install*) return 0 ;;
    esac
    return 1
  }

  # bash-preexec's hooks: D first among the precmd functions, the prompt's marks last.
  __bikube_bp_precmd() {
    __bikube_end
  }
  __bikube_bp_prompt() {
    local status=$? f last=
    __bikube_mark_prompt
    # Functions added after this one (bash-preexec's own `precmd`, a later init) ran first;
    # from the next prompt on, last again.
    for f in ${precmd_functions[@]+"${precmd_functions[@]}"}; do last=$f; done
    if [ "$last" != __bikube_bp_prompt ]; then
      local -a kept
      kept=()
      for f in ${precmd_functions[@]+"${precmd_functions[@]}"}; do
        [ "$f" = __bikube_bp_prompt ] || kept+=("$f")
      done
      precmd_functions=(${kept[@]+"${kept[@]}"} __bikube_bp_prompt)
    fi
    return "$status"
  }
  __bikube_bp_preexec() {
    __bikube_start
  }

  # Hands the marks to bash-preexec: its hooks from now on, the user's own DEBUG trap back (for
  # bash-preexec to keep when it installs at this prompt), and Bikube's PROMPT_COMMAND functions
  # doing nothing. bash-preexec runs every precmd function at each prompt and every preexec
  # function once per command line.
  __bikube_use_bp() {
    __bikube_bp=1
    __bikube_ready=
    precmd_functions=(__bikube_bp_precmd ${precmd_functions[@]+"${precmd_functions[@]}"} __bikube_bp_prompt)
    preexec_functions=(${preexec_functions[@]+"${preexec_functions[@]}"} __bikube_bp_preexec)
    case "$(trap -p DEBUG)" in
      *__bikube_preexec*)
        if [ -n "$__bikube_user_debug" ]; then
          trap -- "$__bikube_user_debug" DEBUG
        else
          trap - DEBUG
        fi
        ;;
    esac
    # Installed already, bash-preexec kept Bikube's trap as a preexec function: the user's alone.
    case "$(declare -f __bp_original_debug_trap 2>/dev/null)" in
      *__bikube_preexec*)
        __bp_original_debug_trap() {
          eval "$__bikube_user_debug"
        }
        ;;
    esac
  }

  # First in PROMPT_COMMAND: ends the command line that ran, keeping its status for the rest.
  __bikube_precmd() {
    __bikube_status=$?
    [ -z "$__bikube_bp" ] || return "$__bikube_status"
    __bikube_ready=
    __bikube_return "$__bikube_status"
    __bikube_end
    # bash-preexec loaded since: its hooks from now on (this prompt's marks come from them).
    if __bikube_bp_present; then
      __bikube_use_bp
    fi
    return "$__bikube_status"
  }

  # Last in PROMPT_COMMAND: the marks around whatever PS1 the user's commands left.
  __bikube_prompt() {
    [ -z "$__bikube_bp" ] || return "$__bikube_status"
    __bikube_mark_prompt
    __bikube_ready=1
    return "$__bikube_status"
  }

  # The DEBUG trap, before every simple command: the first one after a prompt is the user's
  # command line (not PROMPT_COMMAND's own first command after an empty Enter, nor one inside a
  # function under `set -T`), so C goes out once per command line. $1 is $_, given back last.
  __bikube_preexec() {
    local status=$?
    if [ -n "$__bikube_ready" ] && [ "$BASH_COMMAND" != __bikube_precmd ] &&
      [ -z "${FUNCNAME[1]-}" ]; then
      __bikube_ready=
      __bikube_start
    fi
    if [ -n "$__bikube_user_debug" ]; then
      __bikube_return "$status" "$1"
      eval "$__bikube_user_debug"
      __bikube_return "$?" "$1"
    else
      __bikube_return 0 "$1"
    fi
  }

  if __bikube_bp_present; then
    # bash-preexec owns the DEBUG trap and PROMPT_COMMAND: only its hooks.
    __bikube_use_bp
  else
    # The user's DEBUG trap (`trap -- '<command>' DEBUG`), if any, keeps running after Bikube's.
    __bikube_keep_trap() {
      __bikube_user_debug=${3-}
    }
    eval "__bikube_keep_trap $(trap -p DEBUG)"
    unset -f __bikube_keep_trap

    case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
      'declare -a'*)
        # bash 5.1's array form: every element runs in turn.
        PROMPT_COMMAND=(__bikube_precmd "${PROMPT_COMMAND[@]}" __bikube_prompt)
        ;;
      *)
        # Lines, so a user's command ending in `;` or `&` still parses.
        PROMPT_COMMAND=__bikube_precmd$'\n'${PROMPT_COMMAND-}$'\n'__bikube_prompt
        # Exported, a nested bash would run it without Bikube's functions.
        export -n PROMPT_COMMAND
        ;;
    esac
    trap '__bikube_preexec "$_"' DEBUG
  fi

  # Claude Code typed by hand gets Bikube's settings (its hooks: status, activity), as a Claude
  # Code card's start line passes them, whatever the PATH order. A run naming its own
  # --settings, and a `claude` function of the user's, are left alone. `function claude` and not
  # `claude()`: bash expands a user's `alias claude=…` in the latter, a syntax error that would
  # take this whole block with it.
  if ! declare -F claude >/dev/null; then
    function claude {
      local a
      for a in "$@"; do
        case $a in
          --settings | --settings=*) command claude "$@"; return ;;
        esac
      done
      if [[ -n ${BIKUBE_CLAUDE_SETTINGS-} && -f $BIKUBE_CLAUDE_SETTINGS ]]; then
        command claude --settings "$BIKUBE_CLAUDE_SETTINGS" "$@"
      else
        command claude "$@"
      fi
    }
  fi
fi
