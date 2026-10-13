# Context

The domain language of Drovr. One entry per term: what it means here, and what it doesn't.

<!-- - **Term**: definition. Not to be confused with … -->

- **Startup command**: what Drovr types into a card's login shell, followed by Enter, right after each start: `Shell` (nothing), `Claude Code` (`claude` with the card's agent session id), or `Custom` (a one-line command run as written). Each card has its own; a workspace's default startup command is only the preset for new cards. Not to be confused with the login shell itself, which every start runs.
- **Agent session id**: a random UUID v4 a card gets at creation and keeps for life, whatever its startup command; Claude Code cards pass it to `claude --session-id` / `--resume` so reopening the card returns to the same conversation. Not the card's id, nor the PTY session id.
- **Stopped**: a card whose shell has exited; its screen and scrollback are gone, and opening it starts it again with its startup command. Replaces #4's "Exited (code N)". Not to be confused with `Couldn't start`, where the shell never ran.
