# Drovr's shell integration for fish (#45 D3). Drovr puts its folder first in XDG_DATA_DIRS so
# fish runs this file, with the old value in DROVR_XDG_DATA_DIRS ('' when it was unset). This
# puts XDG_DATA_DIRS back, then in an interactive shell marks each prompt and command for the
# terminal: OSC 133 A (prompt start), B (prompt end), C (command output start),
# D;<exit code> (command finished), and OSC 7 with the directory. Nothing else changes: the
# prompt (fish_prompt runs inside a wrapper adding B), $status seen by the user's prompt and
# event handlers, their functions and history.

if set -q DROVR_XDG_DATA_DIRS
    if test -n "$DROVR_XDG_DATA_DIRS"
        set -gx XDG_DATA_DIRS $DROVR_XDG_DATA_DIRS
    else
        set -e XDG_DATA_DIRS
    end
    set -e DROVR_XDG_DATA_DIRS
end

if status is-interactive; and not set -q __drovr_integration
    set -g __drovr_integration 1

    function __drovr_cwd
        printf '\e]7;file://%s%s\a' $hostname (string escape --style=url -- $PWD)
    end

    # The user's fish_prompt, once their config defined it, runs inside one that ends with B.
    function __drovr_wrap_prompt
        functions -q fish_prompt; or return
        functions fish_prompt | string match -q '*__drovr_user_prompt*'; and return
        functions -e __drovr_user_prompt
        functions -c fish_prompt __drovr_user_prompt
        function fish_prompt
            # First, so it sees the prompt's $status.
            __drovr_user_prompt
            printf '\e]133;B\a'
        end
    end

    function __drovr_prompt_start --on-event fish_prompt
        __drovr_wrap_prompt
        __drovr_cwd
        printf '\e]133;A\a'
    end

    function __drovr_preexec --on-event fish_preexec
        printf '\e]133;C\a'
    end

    function __drovr_postexec --on-event fish_postexec
        printf '\e]133;D;%s\a' $status
    end
end
