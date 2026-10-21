# UX standard

What every user-visible change in this repo should look like. Builders (`slice-implementer`) read it before changing UI; the `ux-reviewer` checks a branch against it. It is stack-neutral: where they disagree, the repo's `CLAUDE.md` wins, then `docs/agents/stack.md`, then this standard.

## Rules

- **One spacing scale.** Margins, padding and gaps come from the project's spacing tokens or scale; no one-off values.
- **Aligned edges.** Sibling blocks share left and right edges; columns of labels, fields and buttons line up.
- **One primary action per view.** Other actions are secondary or tertiary in style.
- **Consistent page headers.** Every page uses the same header pattern (title, optional subtitle, actions on the same row) as its neighbours.
- **Use the primitives.** Buttons, fields, badges, panels and alerts come from the project's UI components; colours, spacing and type from its design tokens.
- **Text never overflows.** Long text truncates with an ellipsis or wraps; nothing pushes the page wider than the viewport.
- **No horizontal page scroll** from 320 px wide up. Wide content (tables, code) scrolls inside its own box.
- **Every list and table has an empty state** that says what is missing and what to do next.
- **Every state the change adds is designed:** empty, loading and error, with an error message a user can act on.
- **Dark mode values for every colour** when the app has a dark mode; nothing is readable in one mode only.
- **Readable contrast:** body text at least 4.5:1 against its background, large text (24 px, or 19 px bold) at least 3:1.
- **Touch targets** at least 24 px in both directions.

Every finding gets exactly one class: must-fix or polish.

## Must-fix

The change is broken for some user. The orchestrator sends it back for a fix round before the PR opens.

- broken, overlapping or clipped layout (content cut off by its container without a scroll box or ellipsis)
- horizontal page scroll at 320 px or wider
- text or controls unreadable in light or dark mode: body text contrast below 4.5:1, large text below 3:1
- raw colours, spacing or hand-built controls where the project has UI primitives or design tokens for them
- a state the change introduces (empty, loading, error) that is blank or shows a raw error

## Polish

Everything else this standard covers. Listed in the PR; no fix round.

- alignment off by a few pixels (1–7 px between sibling edges)
- spacing or type scale inconsistent with the neighbouring page
- a crowded or unbalanced layout
- unclear labels, button text or empty-state copy
- touch targets under 24 px
