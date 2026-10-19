# Drovr's shell integration for zsh (#45 D3). Drovr starts zsh with ZDOTDIR set to this folder
# and the user's own ZDOTDIR, when set, in DROVR_ZDOTDIR. This puts ZDOTDIR back at once (unset
# when it was unset), reads the user's own .zshenv, and in an interactive shell loads the
# integration; zsh then reads the user's .zprofile, .zshrc and .zlogin from their own ZDOTDIR.

typeset -g __drovr_zsh_dir=${${(%):-%x}:A:h}
if [[ -n ${DROVR_ZDOTDIR+set} ]]; then
  ZDOTDIR=$DROVR_ZDOTDIR
  unset DROVR_ZDOTDIR
else
  unset ZDOTDIR
fi

if [[ -f ${ZDOTDIR:-$HOME}/.zshenv ]]; then
  builtin source ${ZDOTDIR:-$HOME}/.zshenv
fi

if [[ -o interactive && -r $__drovr_zsh_dir/drovr-integration.zsh ]]; then
  builtin source $__drovr_zsh_dir/drovr-integration.zsh
fi
unset __drovr_zsh_dir
