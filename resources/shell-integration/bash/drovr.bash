# Drovr's shell integration for bash (#45 D3). Drovr starts bash as `bash --init-file <this>`
# instead of `bash -l` (which would ignore --init-file), so this first reads what a login shell
# reads, then marks each prompt and command for the terminal: OSC 133 A (prompt start),
# B (prompt end), C (command output start), D;<exit code> (command finished), and OSC 7 with the
# directory. Nothing else changes: the prompt, $? seen by the user's PROMPT_COMMAND and prompt,
# their DEBUG trap (run after Drovr's) and history are the user's. With bash-preexec (starship,
# atuin), which owns the DEBUG trap and PROMPT_COMMAND, the marks go through its precmd_functions
# and preexec_functions instead, also when it is loaded after this. Safe under the user's `set -u`.
# Works on bash 3.2 (macOS's /bin/bash): no PS0, no ${var@Q}, no associative arrays, no declare -g.
# Drovr adds no variable for bash, so a nested bash is the user's plain one.

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

if [[ $- == *i* ]] && [ -z "${__drovr_integration-}" ]; then
  __drovr_integration=1
  # The status of the command line the prompt follows.
  __drovr_status=0
  # Set once a command line started (its C sent), so its D follows at the next prompt.
  __drovr_ran=
  # Set at the end of PROMPT_COMMAND: the next DEBUG trap is the user's command line.
  __drovr_ready=
  # The user's PS1, and the same with Drovr's marks around it, as set for the prompt.
  __drovr_ps1=
  __drovr_ps1_marked=
  # The user's own DEBUG trap when this was loaded, run after Drovr's.
  __drovr_user_debug=
  # Set once the marks go through bash-preexec's hooks instead of Drovr's trap.
  __drovr_bp=

  # Sets $? (and, through its last argument, $_) for whatever runs next.
  __drovr_return() {
    return "$1"
  }

  # OSC 7 with $PWD, every byte but [a-zA-Z0-9/._~-] percent-encoded. LC_ALL is C for the loop
  # (bytes, not characters) and put back explicitly afterwards, unset when it was unset.
  __drovr_cwd() {
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

  # D for the command line that ran, if one did; $? is its status, given back.
  __drovr_end() {
    __drovr_status=$?
    if [ -n "$__drovr_ran" ]; then
      __drovr_ran=
      builtin printf '\033]133;D;%s\007' "$__drovr_status"
    fi
    return "$__drovr_status"
  }

  # A and B around whatever PS1 the user's commands left, and OSC 7.
  __drovr_mark_prompt() {
    if [ "$PS1" != "$__drovr_ps1_marked" ]; then
      __drovr_ps1=$PS1
      __drovr_ps1_marked='\[\033]133;A\007\]'$PS1'\[\033]133;B\007\]'
    fi
    PS1=$__drovr_ps1_marked
    __drovr_cwd
  }

  # C as the user's command line starts, with the user's own PS1 back while it runs.
  __drovr_start() {
    __drovr_ran=1
    PS1=$__drovr_ps1
    builtin printf '\033]133;C\007'
  }

  # bash-preexec is loaded and will run its hooks: its precmd_functions run at every prompt
  # (from its PROMPT_COMMAND, or the install line it adds there for the first prompt).
  __drovr_bp_present() {
    [ -n "${bash_preexec_imported-}${__bp_imported-}" ] || return 1
    case "${PROMPT_COMMAND[*]-}" in
      *__bp_precmd_invoke_cmd* | *__bp_install*) return 0 ;;
    esac
    return 1
  }

  # bash-preexec's hooks: D first among the precmd functions, the prompt's marks last.
  __drovr_bp_precmd() {
    __drovr_end
  }
  __drovr_bp_prompt() {
    local status=$? f last=
    __drovr_mark_prompt
    # Functions added after this one (bash-preexec's own `precmd`, a later init) ran first;
    # from the next prompt on, last again.
    for f in ${precmd_functions[@]+"${precmd_functions[@]}"}; do last=$f; done
    if [ "$last" != __drovr_bp_prompt ]; then
      local -a kept
      kept=()
      for f in ${precmd_functions[@]+"${precmd_functions[@]}"}; do
        [ "$f" = __drovr_bp_prompt ] || kept+=("$f")
      done
      precmd_functions=(${kept[@]+"${kept[@]}"} __drovr_bp_prompt)
    fi
    return "$status"
  }
  __drovr_bp_preexec() {
    __drovr_start
  }

  # Hands the marks to bash-preexec: its hooks from now on, the user's own DEBUG trap back (for
  # bash-preexec to keep when it installs at this prompt), and Drovr's PROMPT_COMMAND functions
  # doing nothing. bash-preexec runs every precmd function at each prompt and every preexec
  # function once per command line.
  __drovr_use_bp() {
    __drovr_bp=1
    __drovr_ready=
    precmd_functions=(__drovr_bp_precmd ${precmd_functions[@]+"${precmd_functions[@]}"} __drovr_bp_prompt)
    preexec_functions=(${preexec_functions[@]+"${preexec_functions[@]}"} __drovr_bp_preexec)
    case "$(trap -p DEBUG)" in
      *__drovr_preexec*)
        if [ -n "$__drovr_user_debug" ]; then
          trap -- "$__drovr_user_debug" DEBUG
        else
          trap - DEBUG
        fi
        ;;
    esac
    # Installed already, bash-preexec kept Drovr's trap as a preexec function: the user's alone.
    case "$(declare -f __bp_original_debug_trap 2>/dev/null)" in
      *__drovr_preexec*)
        __bp_original_debug_trap() {
          eval "$__drovr_user_debug"
        }
        ;;
    esac
  }

  # First in PROMPT_COMMAND: ends the command line that ran, keeping its status for the rest.
  __drovr_precmd() {
    __drovr_status=$?
    [ -z "$__drovr_bp" ] || return "$__drovr_status"
    __drovr_ready=
    __drovr_return "$__drovr_status"
    __drovr_end
    # bash-preexec loaded since: its hooks from now on (this prompt's marks come from them).
    if __drovr_bp_present; then
      __drovr_use_bp
    fi
    return "$__drovr_status"
  }

  # Last in PROMPT_COMMAND: the marks around whatever PS1 the user's commands left.
  __drovr_prompt() {
    [ -z "$__drovr_bp" ] || return "$__drovr_status"
    __drovr_mark_prompt
    __drovr_ready=1
    return "$__drovr_status"
  }

  # The DEBUG trap, before every simple command: the first one after a prompt is the user's
  # command line (not PROMPT_COMMAND's own first command after an empty Enter, nor one inside a
  # function under `set -T`), so C goes out once per command line. $1 is $_, given back last.
  __drovr_preexec() {
    local status=$?
    if [ -n "$__drovr_ready" ] && [ "$BASH_COMMAND" != __drovr_precmd ] &&
      [ -z "${FUNCNAME[1]-}" ]; then
      __drovr_ready=
      __drovr_start
    fi
    if [ -n "$__drovr_user_debug" ]; then
      __drovr_return "$status" "$1"
      eval "$__drovr_user_debug"
      __drovr_return "$?" "$1"
    else
      __drovr_return 0 "$1"
    fi
  }

  if __drovr_bp_present; then
    # bash-preexec owns the DEBUG trap and PROMPT_COMMAND: only its hooks.
    __drovr_use_bp
  else
    # The user's DEBUG trap (`trap -- '<command>' DEBUG`), if any, keeps running after Drovr's.
    __drovr_keep_trap() {
      __drovr_user_debug=${3-}
    }
    eval "__drovr_keep_trap $(trap -p DEBUG)"
    unset -f __drovr_keep_trap

    case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
      'declare -a'*)
        # bash 5.1's array form: every element runs in turn.
        PROMPT_COMMAND=(__drovr_precmd "${PROMPT_COMMAND[@]}" __drovr_prompt)
        ;;
      *)
        # Lines, so a user's command ending in `;` or `&` still parses.
        PROMPT_COMMAND=__drovr_precmd$'\n'${PROMPT_COMMAND-}$'\n'__drovr_prompt
        # Exported, a nested bash would run it without Drovr's functions.
        export -n PROMPT_COMMAND
        ;;
    esac
    trap '__drovr_preexec "$_"' DEBUG
  fi
fi
