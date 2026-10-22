# Bikube's shell integration for zsh (#45 D3), loaded by Bikube's .zshenv in an interactive shell.
# Marks each prompt and command for the terminal: OSC 133 A (prompt start), B (prompt end),
# C (command output start), D;<exit code> (command finished), and OSC 7 with the directory.
# Nothing else changes: the prompt (the marks are added around it only while it shows), $? seen by the
# user's own hooks (zsh gives every precmd hook the command's status), their precmd and preexec
# hooks and history.

if (( ! ${+__bikube_integration} )); then
  typeset -g __bikube_integration=1
  # Set once a command line started (its C sent), so its D follows at the next prompt.
  typeset -g __bikube_ran=
  # The user's PS1, and the same with B at its end, as set for the prompt.
  typeset -g __bikube_ps1= __bikube_ps1_marked=
  # While this prompt's marks wait for zle-line-init: `user` (the user's widget kept aside) or
  # `none`.
  typeset -g __bikube_deferred=

  __bikube_cwd() {
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
  __bikube_precmd() {
    local ret=$?
    emulate -L zsh
    if [[ -n $__bikube_ran ]]; then
      __bikube_ran=
      builtin print -rn -- $'\e]133;D;'$ret$'\a'
    fi
    __bikube_cwd
    return ret
  }

  # Last in precmd_functions, so it sees the PS1 the user's own hooks left: A, and B where the
  # prompt ends, out of the prompt's width (only with prompt % escapes). Loaded from .zshenv,
  # these hooks come before the ones the user's .zshrc adds, which still run after this one at
  # this prompt (zsh runs a copy of the array) and may print or set PS1 (themes): then both marks
  # go into the prompt itself once zle has shown it, and from the next prompt on this is last.
  __bikube_prompt() {
    local ret=$?
    emulate -L zsh
    __bikube_undefer
    # Bikube's marks off the prompt, so they are added once, around the user's PS1.
    if [[ $PS1 == $__bikube_ps1_marked ]]; then
      PS1=$__bikube_ps1
    fi
    if [[ ${precmd_functions[-1]} == __bikube_prompt ]] || [[ ! -o promptpercent ]] ||
      [[ ! -o zle ]]; then
      __bikube_mark
    elif ! __bikube_defer; then
      __bikube_mark
    fi
    if [[ ${precmd_functions[1]} != __bikube_precmd || ${precmd_functions[-1]} != __bikube_prompt ]]; then
      precmd_functions=(
        __bikube_precmd ${precmd_functions:#__bikube_(precmd|prompt)} __bikube_prompt
      )
    fi
    return ret
  }

  # A now, and B at the end of PS1 (only with prompt % escapes).
  __bikube_mark() {
    builtin print -rn -- $'\e]133;A\a'
    if [[ -o promptpercent ]]; then
      __bikube_ps1=$PS1
      __bikube_ps1_marked=$PS1$'%{\e]133;B\a%}'
      PS1=$__bikube_ps1_marked
    fi
  }

  # This prompt's A and B from zle-line-init, the user's own widget (if any) run first and put
  # back: its PS1 is final then, and redrawing it puts A where the prompt starts. Not while an
  # earlier deferral's user widget is still kept aside (a widget defined since wraps Bikube's).
  __bikube_defer() {
    zmodload -i zsh/zleparameter 2>/dev/null
    (( ! ${+widgets[__bikube_user_line_init]} )) || return 1
    if (( ${+widgets[zle-line-init]} )); then
      zle -A zle-line-init __bikube_user_line_init
      __bikube_deferred=user
    else
      __bikube_deferred=none
    fi
    zle -N zle-line-init __bikube_line_init
  }

  # A deferral not undone yet: the user's widget back, only while zle-line-init is still Bikube's.
  # A widget defined since (a later precmd hook, a plugin's lazy init) stays, and the user's
  # widget kept aside stays too, for Bikube's to call through when that one wraps it.
  __bikube_undefer() {
    if [[ -n $__bikube_deferred && ${widgets[zle-line-init]-} == user:__bikube_line_init ]]; then
      case $__bikube_deferred in
        user)
          zle -A __bikube_user_line_init zle-line-init
          zle -D __bikube_user_line_init
          ;;
        none) zle -D zle-line-init ;;
      esac
    fi
    __bikube_deferred=
  }

  # zle-line-init while deferred, or a copy of it a widget defined since keeps calling: the user's
  # widget it stands for runs first; the marks only while this prompt's are deferred.
  __bikube_line_init() {
    local deferred=$__bikube_deferred mine=
    [[ ${widgets[zle-line-init]-} != user:__bikube_line_init ]] || mine=1
    __bikube_undefer
    if [[ -n $mine && $deferred == user ]]; then
      zle zle-line-init -- "$@"
    elif (( ${+widgets[__bikube_user_line_init]} )); then
      zle __bikube_user_line_init -- "$@"
    fi
    [[ -n $deferred ]] || return 0
    emulate -L zsh
    if [[ $PS1 == $__bikube_ps1_marked ]]; then
      PS1=$__bikube_ps1
    fi
    __bikube_ps1=$PS1
    __bikube_ps1_marked=$'%{\e]133;A\a%}'$PS1$'%{\e]133;B\a%}'
    PS1=$__bikube_ps1_marked
    zle .reset-prompt
  }

  __bikube_preexec() {
    emulate -L zsh
    if [[ $PS1 == $__bikube_ps1_marked ]]; then
      PS1=$__bikube_ps1
    fi
    __bikube_ran=1
    builtin print -rn -- $'\e]133;C\a'
  }

  typeset -ga precmd_functions preexec_functions
  precmd_functions=(__bikube_precmd ${precmd_functions[@]} __bikube_prompt)
  preexec_functions+=(__bikube_preexec)
fi
