# Drovr

A macOS kanban board where every card is a live terminal, for running many coding agents side by side.

## The `board` command

Inside a card's terminal, the agent (or you) can update the board:

- `board move <card> <column>` moves a card to the bottom of a column, e.g. `board move . Done`.
- `board status <card> <text>` shows a short status line on a running card; `""` clears it.

`<card>` is a card's title or id in the same workspace, or `.` for the card you are in. `board` works only inside a Drovr card: Drovr puts it on the card's PATH, so there is nothing to install. `board help` prints the usage.
