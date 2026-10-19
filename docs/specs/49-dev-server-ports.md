---
item: 49
type: feature
title: Detect dev-server ports and open them
status: draft
branch: claude/49-dev-server-ports
---

# Detect dev-server ports and open them

## Problem

Several worktree cards and named shells often each run their own dev server, each on its own port, and the user loses track of which card serves which port. That is the "which window is doing what" problem Drovr exists for. After this ships, a local card or shell whose terminal printed a local URL such as `http://localhost:5173/` shows a small `localhost:5173` chip while something is listening on that port. Clicking the chip opens the URL in the default browser. Related to #45 (in review), which also changes how card output is handled; this item keeps its own logic in new modules and adds only a small hook to the output path.

## Domain decisions

- **D1 – Detection from output:** a **dev server URL** is an `http` or `https` URL in a terminal's output whose host is `localhost`, `127.0.0.1`, `0.0.0.0` or `[::1]` (any case), with an explicit port from 1 to 65535, optionally followed by a path. Output is read line by line after escape sequences and control characters are removed (`stripEscapes`), so a URL whose port is coloured, like Vite's `http://localhost:\x1b[1m5173\x1b[22m/`, is found. A line split across output chunks is joined: the unfinished last line is carried to the next chunk, keeping at most its last 4,096 characters. Trailing `.`, `,`, `;`, `:`, `)`, `]`, `'`, `"` and `>` are not part of the URL. Not detected: a URL without a port, any other host (a LAN address such as Vite's `Network:` line, a domain name), or a port outside the range. *Why:* small and cross-platform. Per-process socket detection (lsof, `/proc`) was rejected as much more work for the item's needs.
- **D2 – What is read:** only output a session's shell produced in the current start of that pane: never the kept output written above it (#46), and never output from before the pane's current start.
- **D3 – One chip per port:** each pane keeps its ports in the order they were first seen. Printing the same port again replaces its URL with the newer one but keeps its position. A card's ports are its panes' ports, main pane first and then the extra panes in creation order, without duplicates (the first pane that printed a port keeps it).
- **D4 – Shown only while listening:** a port's chip shows only while a probe from main finds something accepting TCP connections on it on the loopback interface (`127.0.0.1` or `::1`, open if either accepts within 500 ms). A port is probed at once when it is first seen, then every 3 s while the window is focused and at once when the window regains focus. Nothing is probed while the window is unfocused, so chips keep their last state. A port found closed stays known and its chip comes back when a later probe finds it open. *Why:* stopping a dev server with Ctrl+C leaves its shell running; without a probe the chip would point to a server that is gone.
- **D5 – Forgotten when the pane ends:** a pane's ports are forgotten when its shell exits, when the pane is closed, and when the card or shell is restarted, deleted or Closed. After a restart of the app nothing is remembered: ports are runtime only and are never saved, synced or put in the state file.
- **D6 – Local only:** SSH cards and their panes, and the shells of an SSH workspace, get no chips. *Why:* `localhost` there is the remote host, so opening it on this machine would open the wrong thing.
- **D7 – Where chips show:** on a board card, a row of chips under its status lines, outside the card's open button (like the pull request chip, #38), so clicking a chip never opens the card. On a workspace shell, the chips appear right after its chip in the shell strip. Nothing is added to the open card's view: its terminal already shows the URL, which opens with Mod+click. Chips show only while the card or shell is running.
- **D8 – The chip:** reads `localhost:<port>` whatever host was printed, has the title `Open <url>`, and clicking it opens the port's URL as printed, with `0.0.0.0` replaced by `localhost`, through main's existing link opening (`link:open`, http and https only). It opens nothing else. At most 3 chips show, in the order of D3, followed by a `+N` chip whose title lists the other URLs; clicking `+N` opens nothing.
- **D9 – The probe in main:** a new IPC call that takes a list of port numbers and answers with the ones that are open. Main accepts it only from a window's main frame, ignores anything that isn't an integer from 1 to 65535, probes at most 32 ports per call, and only ever connects to `127.0.0.1` and `::1`, closing each connection at once without sending anything.
- **D10 – No embedded preview:** opening is always in the default browser. *Why:* a webview would widen the window's security surface (#3's sandboxed settings) and is far larger work. It can be a later item.

## Acceptance criteria

- **AC1 – Chip on a card:** Given a local workspace with a running card and an HTTP server listening on `127.0.0.1:<p>`, when the card's shell prints `  Local:   http://localhost:\x1b[1m<p>\x1b[22m/`, then within 4 s the board card shows one chip `localhost:<p>` with title `Open http://localhost:<p>/`. Clicking it opens `http://localhost:<p>/` (`shell.openExternal` stubbed) and the board stays shown, with the card not opened.
- **AC2 – Not listening:** Given a running card that prints `http://localhost:<q>/` where nothing listens on `<q>`, then no chip shows after 4 s. When a server starts listening on `<q>`, then within 4 s the chip `localhost:<q>` shows.
- **AC3 – Server stops:** Given a card showing `localhost:<p>`, when the server on `<p>` closes while the card's shell keeps running, then within 4 s the chip is gone. When it listens on `<p>` again, the chip comes back within 4 s.
- **AC4 – Pane ends:** Given a card showing `localhost:<p>` from its main pane, when the user types `exit` in its shell, then the card is Stopped and shows no chip. When it is opened again with the server still listening, it shows no chip until `<p>` is printed again.
- **AC5 – Extra pane:** Given a running card split into 2 panes where the extra pane printed `http://127.0.0.1:<p>/app` and the main pane printed `http://0.0.0.0:<r>` (both listening), then the board card shows `localhost:<r>` then `localhost:<p>`. Clicking `localhost:<r>` opens `http://localhost:<r>/`, and clicking `localhost:<p>` opens `http://127.0.0.1:<p>/app`. Closing the extra pane removes `localhost:<p>` within 4 s.
- **AC6 – Shell:** Given a named shell whose command prints `http://localhost:<p>/` with a server listening, then the shell strip shows `localhost:<p>` beside that shell, and clicking it opens the URL.
- **AC7 – SSH:** Given an SSH workspace card (fake `ssh`) that prints `http://localhost:<p>/` with a local server listening on `<p>`, then no chip shows after 4 s.
- **AC8 – Overflow:** Given a card that printed 5 listening ports, then it shows the first 3 chips in print order and a `+2` chip whose title lists the other two URLs.
- **AC9 – Parser (Vitest):** the URL is found when split across chunks at any position, including inside an escape sequence. Coloured ports are found. `0.0.0.0` and `[::1]` are recognised. Trailing punctuation is dropped. No URL is found for `http://localhost/`, `http://192.168.1.5:5173/`, `http://example.com:3000/`, port `0` or port `70000`. A line longer than 4,096 characters without a newline doesn't grow the carry past 4,096 characters.
- **AC10 – Registry (Vitest):** ports are kept in first-seen order with the newest URL, the card's list merges panes with the main pane first and no duplicates, a pane's ports are forgotten when it ends, and only probed-open ports are listed. Probes run on a new port, on the interval and on focus while focused, and never while unfocused (fake clock and fake probe).
- **AC11 – Probe (Vitest):** with an injected connector, the probe answers only the integer ports from 1 to 65535 among the first 32, connects only to `127.0.0.1` and `::1`, and counts a port open when either address accepts within 500 ms.

## Slices

Build in this order. Each slice is vertical and ends with green checks.

1. **S1 – Chips on a card's main pane:** the output parser (D1) and the per-card port registry (D3–D5) in core, fed from the main pane's session output only (D2) and only for local cards (D6). The main-process probe (D9) with its IPC and preload bridge. The board card's chip row with the `+N` overflow (D7, D8). e2e tests in a new `e2e/dev-servers.spec.ts` with real HTTP servers started by the test on free ports. AGENTS.md's test list and CONTEXT.md (a **Dev server chip** entry) are updated. Satisfies AC1–AC4, AC7–AC11.
2. **S2 – Extra panes and shells:** extra panes' output feeds the registry (forgotten when the pane closes or exits), and the shell strip shows a shell's chips. Tests are added to `e2e/dev-servers.spec.ts` and AGENTS.md is updated. Satisfies AC5, AC6.

## Test seams and verification

| AC | Test seam | How to verify on the running app |
|---|---|---|
| AC1 | e2e `e2e/dev-servers.spec.ts` | start a Node HTTP server, `printf` the coloured URL in a card, check the chip, click it |
| AC2 | e2e | print a URL for a free port, check no chip, then listen and check |
| AC3 | e2e | close the server, check the chip is gone, listen again |
| AC4 | e2e | `exit`, check Stopped with no chip; reopen |
| AC5 | e2e | split, print in both panes, check order and opened URLs, close the pane |
| AC6 | e2e | a named shell whose command prints the URL |
| AC7 | e2e (fake `ssh` from `e2e/fake-ssh.ts`) | SSH card prints a URL of a listening port; no chip |
| AC8 | e2e | 5 servers, check 3 chips and `+2` |
| AC9 | Vitest, the parser module in `src/core` | — |
| AC10 | Vitest, the registry module in `src/core` | — |
| AC11 | Vitest, the probe module in `src/core` | — |

## Stack changes

None.

## Data and migrations

None. Ports are runtime only and are not added to the state, settings or sync files.

## Out of scope

- An embedded preview (D10).
- Per-process port detection (lsof, `/proc`), and ports a server never prints.
- SSH port forwarding or chips for SSH cards (D6).
- Chips in the open card's view, palette rows for ports, and notifications.

## Open questions

None.
