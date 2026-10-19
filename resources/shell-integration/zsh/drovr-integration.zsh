# Drovr's shell integration for zsh (#45 D3), loaded by Drovr's .zshenv in an interactive shell.
# Marks each prompt and command for the terminal: OSC 133 A (prompt start), B (prompt end),
# C (command output start), D;<exit code> (command finished), and OSC 7 with the directory.
# Nothing else changes: the prompt (B is added around it only while it shows), $? seen by the
# user's own hooks (zsh gives every precmd hook the command's status), their precmd and preexec
# hooks and history.

if (( ! ${+__drovr_integration} )); then
  typeset -g __drovr_integration=1
  # Set once a command line started (its C sent), so its D follows at the next prompt.
  typeset -g __drovr_ran=
  # The user's PS1, and the same with B at its end, as set for the prompt.
  typeset -g __drovr_ps1= __drovr_ps1_marked=

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

  # Last in precmd_functions, so it sees the PS1 the user's own hooks left.
  __drovr_precmd() {
    local ret=$?
    emulate -L zsh
    if [[ -n $__drovr_ran ]]; then
      __drovr_ran=
      builtin print -rn -- $'\e]133;D;'$ret$'\a'
    fi
    __drovr_cwd
    builtin print -rn -- $'\e]133;A\a'
    # B where the prompt ends, out of the prompt's width; only with prompt % escapes.
    if [[ -o promptpercent ]]; then
      if [[ $PS1 != $__drovr_ps1_marked ]]; then
        __drovr_ps1=$PS1
        __drovr_ps1_marked=$PS1$'%{\e]133;B\a%}'
      fi
      PS1=$__drovr_ps1_marked
    fi
    # Hooks the user's .zshrc added after this one ran first; from the next prompt on, last.
    if [[ ${precmd_functions[-1]} != __drovr_precmd ]]; then
      precmd_functions=(${precmd_functions:#__drovr_precmd} __drovr_precmd)
    fi
    return ret
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
  precmd_functions+=(__drovr_precmd)
  preexec_functions+=(__drovr_preexec)
fi
