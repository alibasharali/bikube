# Drovr's shell integration for zsh (#45 D3), loaded by Drovr's .zshenv in an interactive shell.
# Marks each prompt and command for the terminal: OSC 133 A (prompt start), B (prompt end),
# C (command output start), D;<exit code> (command finished), and OSC 7 with the directory.
# Nothing else changes: the prompt (the marks are added around it only while it shows), $? seen by the
# user's own hooks (zsh gives every precmd hook the command's status), their precmd and preexec
# hooks and history.

if (( ! ${+__drovr_integration} )); then
  typeset -g __drovr_integration=1
  # Set once a command line started (its C sent), so its D follows at the next prompt.
  typeset -g __drovr_ran=
  # The user's PS1, and the same with B at its end, as set for the prompt.
  typeset -g __drovr_ps1= __drovr_ps1_marked=
  # While this prompt's marks wait for zle-line-init: `user` (the user's widget kept aside) or
  # `none`.
  typeset -g __drovr_deferred=

  __drovr_cwd() {
    emulate -L zsh
    local LC_ALL=C
    local out= c n i
    for (( i = 1; i <= ${#PWD}; i++ )); do
      c=${PWD[i]}
      if [[ $c == [a-zA-Z0-9/._~-] ]]; then
        out+=$c
      else
        n=$(( #c & 255 ))
        out+=%${(l:2::0:)$(( [##16] n ))}
      fi
    done
    builtin print -rn -- $'\e]7;file://'$HOST$out$'\a'
  }

  # First in precmd_functions: D for the command line that ran, before any hook of the user's
  # prints, and OSC 7.
  __drovr_precmd() {
    local ret=$?
    emulate -L zsh
    if [[ -n $__drovr_ran ]]; then
      __drovr_ran=
      builtin print -rn -- $'\e]133;D;'$ret$'\a'
    fi
    __drovr_cwd
    return ret
  }

  # Last in precmd_functions, so it sees the PS1 the user's own hooks left: A, and B where the
  # prompt ends, out of the prompt's width (only with prompt % escapes). Loaded from .zshenv,
  # these hooks come before the ones the user's .zshrc adds, which still run after this one at
  # this prompt (zsh runs a copy of the array) and may print or set PS1 (themes): then both marks
  # go into the prompt itself once zle has shown it, and from the next prompt on this is last.
  __drovr_prompt() {
    local ret=$?
    emulate -L zsh
    __drovr_undefer
    # Drovr's marks off the prompt, so they are added once, around the user's PS1.
    if [[ $PS1 == $__drovr_ps1_marked ]]; then
      PS1=$__drovr_ps1
    fi
    if [[ ${precmd_functions[-1]} == __drovr_prompt ]] || [[ ! -o promptpercent ]] ||
      [[ ! -o zle ]]; then
      builtin print -rn -- $'\e]133;A\a'
      if [[ -o promptpercent ]]; then
        __drovr_ps1=$PS1
        __drovr_ps1_marked=$PS1$'%{\e]133;B\a%}'
        PS1=$__drovr_ps1_marked
      fi
    else
      __drovr_defer
    fi
    if [[ ${precmd_functions[1]} != __drovr_precmd || ${precmd_functions[-1]} != __drovr_prompt ]]; then
      precmd_functions=(
        __drovr_precmd ${precmd_functions:#__drovr_(precmd|prompt)} __drovr_prompt
      )
    fi
    return ret
  }

  # This prompt's A and B from zle-line-init, the user's own widget (if any) run first and put
  # back: its PS1 is final then, and redrawing it puts A where the prompt starts.
  __drovr_defer() {
    zmodload -i zsh/zleparameter 2>/dev/null
    if (( ${+widgets[zle-line-init]} )); then
      zle -A zle-line-init __drovr_user_line_init
      __drovr_deferred=user
    else
      __drovr_deferred=none
    fi
    zle -N zle-line-init __drovr_line_init
  }

  # A deferral not undone yet (zle-line-init not run since): the user's widget back.
  __drovr_undefer() {
    case $__drovr_deferred in
      user)
        zle -A __drovr_user_line_init zle-line-init
        zle -D __drovr_user_line_init
        ;;
      none) zle -D zle-line-init ;;
    esac
    __drovr_deferred=
  }

  __drovr_line_init() {
    local had_user=$__drovr_deferred
    __drovr_undefer
    if [[ $had_user == user ]]; then
      zle zle-line-init -- "$@"
    fi
    emulate -L zsh
    if [[ $PS1 == $__drovr_ps1_marked ]]; then
      PS1=$__drovr_ps1
    fi
    __drovr_ps1=$PS1
    __drovr_ps1_marked=$'%{\e]133;A\a%}'$PS1$'%{\e]133;B\a%}'
    PS1=$__drovr_ps1_marked
    zle .reset-prompt
  }

  __drovr_preexec() {
    emulate -L zsh
    if [[ $PS1 == $__drovr_ps1_marked ]]; then
      PS1=$__drovr_ps1
    fi
    __drovr_ran=1
    builtin print -rn -- $'\e]133;C\a'
  }

  typeset -ga precmd_functions preexec_functions
  precmd_functions=(__drovr_precmd ${precmd_functions[@]} __drovr_prompt)
  preexec_functions+=(__drovr_preexec)
fi
