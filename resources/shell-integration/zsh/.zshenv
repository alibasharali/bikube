# Bikube's shell integration for zsh (#45 D3). Bikube starts zsh with ZDOTDIR set to this folder
# and the user's own ZDOTDIR, when set, in BIKUBE_ZDOTDIR. This puts ZDOTDIR back at once (unset
# when it was unset), reads the user's own .zshenv, and in an interactive shell loads the
# integration; zsh then reads the user's .zprofile, .zshrc and .zlogin from their own ZDOTDIR.

typeset -g __bikube_zsh_dir=${${(%):-%x}:A:h}
if [[ -n ${BIKUBE_ZDOTDIR+set} ]]; then
  ZDOTDIR=$BIKUBE_ZDOTDIR
  unset BIKUBE_ZDOTDIR
else
  unset ZDOTDIR
fi

if [[ -f ${ZDOTDIR:-$HOME}/.zshenv ]]; then
  builtin source ${ZDOTDIR:-$HOME}/.zshenv
fi

if [[ -o interactive && -r $__bikube_zsh_dir/bikube-integration.zsh ]]; then
  builtin source $__bikube_zsh_dir/bikube-integration.zsh
fi
unset __bikube_zsh_dir
