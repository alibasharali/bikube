# Bikube's shell integration for fish (#45 D3). Bikube puts its folder first in XDG_DATA_DIRS so
# fish runs this file, with the old value in BIKUBE_XDG_DATA_DIRS ('' when it was unset). This
# puts XDG_DATA_DIRS back, then in an interactive shell marks each prompt and command for the
# terminal: OSC 133 A (prompt start), B (prompt end), C (command output start),
# D;<exit code> (command finished), and OSC 7 with the directory. Nothing else changes: the
# prompt (fish_prompt runs inside a wrapper adding B), $status seen by the user's prompt and
# event handlers, their functions and history. It also defines `claude`, adding Bikube's Claude
# Code settings (see below).

if set -q BIKUBE_XDG_DATA_DIRS
    if test -n "$BIKUBE_XDG_DATA_DIRS"
        set -gx XDG_DATA_DIRS $BIKUBE_XDG_DATA_DIRS
    else
        set -e XDG_DATA_DIRS
    end
    set -e BIKUBE_XDG_DATA_DIRS
end

if status is-interactive; and not set -q __bikube_integration
    set -g __bikube_integration 1

    function __bikube_cwd
        printf '\e]7;file://%s%s\a' $hostname (string escape --style=url -- $PWD)
    end

    # The user's fish_prompt, once their config defined it, runs inside one that ends with B.
    function __bikube_wrap_prompt
        functions -q fish_prompt; or return
        functions fish_prompt | string match -q '*__bikube_user_prompt*'; and return
        functions -e __bikube_user_prompt
        functions -c fish_prompt __bikube_user_prompt
        function fish_prompt
            # First, so it sees the prompt's $status.
            __bikube_user_prompt
            printf '\e]133;B\a'
        end
    end

    function __bikube_prompt_start --on-event fish_prompt
        __bikube_wrap_prompt
        __bikube_cwd
        printf '\e]133;A\a'
    end

    function __bikube_preexec --on-event fish_preexec
        printf '\e]133;C\a'
    end

    function __bikube_postexec --on-event fish_postexec
        printf '\e]133;D;%s\a' $status
    end

    # Claude Code typed by hand gets Bikube's settings (its hooks: status, activity), as a Claude
    # Code card's start line passes them, whatever the PATH order. A run naming its own
    # --settings is left alone, and a `claude` function in the user's config replaces this one.
    if not functions -q claude
        function claude
            # `string match` with no arguments would read stdin: only with some.
            if contains -- --settings $argv; or begin
                    set -q argv[1]; and string match -q -- '--settings=*' $argv
                end
                command claude $argv
            else if test -n "$BIKUBE_CLAUDE_SETTINGS"; and test -f "$BIKUBE_CLAUDE_SETTINGS"
                command claude --settings $BIKUBE_CLAUDE_SETTINGS $argv
            else
                command claude $argv
            end
        end
    end
end
