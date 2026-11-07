# Design climb brief: Brainstorm app UI

Rob agreed this brief on 2026-11-05. A fresh session can run the climb from this file and the `hillclimb-ui` skill alone.

## Goal

Brainstorm is a tool Rob keeps open all day beside T3 Code and the Claude desktop app. It should follow their layout and interaction patterns. Seen side by side, it must beat both on every design measure below.

## Measures

Reviewers score each area out of 10:

1. **Shell.** The sidebar, top bar, main card and the frame around them.
2. **Navigation and lists.** Home project groups, session rows, the brainstorm panel, the variant lists.
3. **Canvas chrome.** Frame labels and sizes, the selected-frame ring, pins, pick mode, scrolling. Agent-written block content is out of scope.
4. **Inspector and controls.** Every control type, its labels, values and overridden state.
5. **Overlays.** The Regenerate and Export popovers, the pin composer, tooltips and notices.
6. **Feedback.** Open, addressed and confirmed items and their actions.
7. **States.** Empty, loading and error states, every request phase, the lost thread, and block compile errors.
8. **Dark mode.** Parity, contrast, surfaces.
9. **Self-consistency.** One meaning per colour, one style per component, one scale per property.
10. **Fitness for all-day use.** Density, hierarchy, keyboard reach, calm.

Each sheet puts Brainstorm beside one exemplar, Claude desktop or T3 Code. For each sheet, reviewers also give Brainstorm and the exemplar a score on the same areas, using only what the sheet shows.

## The bar

A round passes when all of these hold:

- Every council member scores every area **9.5 or higher**.
- Every member says they are completely happy.
- No member lists a blocker or a major.
- On every comparison sheet, every member scores Brainstorm above the exemplar in every area the sheet shows, and names Brainstorm the better of the pair.

Sign-off then repeats the round on a random sample with a fresh council and no findings log.

## What sets the look

- **Layout and patterns** come from Claude desktop and T3 Code. That means the sidebar with project groups, the inset main card, quiet chrome and dense lists.
- **Brand layer.** Brainstorm has its own restrained signature: one accent hue and one mark. The accent means "Brainstorm and the agent" and is used only for:
  - selection
  - the Regenerate action
  - agent activity
  - pins

  Everything else is neutral. The hue and the mark are chosen in the foundation phase and shown to Rob at the checkpoint.
- The exemplars set the bar for polish and consistency, not the look. Don't drift toward their greys where the accent has a job.

## Scope

- **In.** Every screen and state of the Electron app's own UI:
  - home, both empty and populated
  - the brainstorm panel
  - the top bar and every request phase
  - the canvas chrome, the Inspector, feedback and the overlays
  - the collapsed sidebar

  Cover light and dark, at 1440×900 and at the smallest supported window, 1100×720.
- **Out.**
  - The content of agent-written blocks.
  - The exported HTML file's own page, except where it reuses the shell's components.
  - The CLI.

## Behaviour changes allowed

Change behaviour only where the UX falls short of the exemplars' patterns. Log each change in the findings log before it lands. These are pre-approved:

- Going back to all brainstorms keeps the open brainstorm's canvas until another is chosen.
- Thread status stays current while a session is open, so the lost marker shows without a restart.
- Keyboard shortcuts:
  - toggle the sidebar
  - open Regenerate
  - send from the composer and the Regenerate box
  - Escape closes overlays
  - move up and down the session and variant lists
- Resizable sidebar and Inspector widths, remembered per viewer.
- Real loading states and empty states wherever data can be missing.

Anything else a reviewer asks for that changes behaviour goes to Rob first.

Rob added these on 2026-11-06, after round 2:

- **Stage view (replaces X1, the Fit zoom).**
  - The centre of a brainstorm shows one slot at a time, filling the space between the sidebars. Tabs or arrows move between slots.
  - A slot narrower than the stage sits centred at its declared width.
  - A slot that declares a page width fills the stage.
  - An "All slots" toggle brings back the side-by-side board, so the whole flow is still visible at a glance.
- **X2.** Long variant notes collapse behind "More".
- **X3.** Notices get a close button and clear on the next success.
- **X4.** The Inspector collapses to a rail.
- **X5.** Deleting feedback asks for confirmation.
- **X6.** Pane widths survive an app restart, stored by the server because the app's origin changes with each launch's port.

Rob added these on 2026-11-06, after round 4, when both home sheets lost on navigation:

- **Home previews.** Each overview card shows a live preview of the brainstorm's latest iteration, so home is where Rob picks visually.
- **Search and filters.** Home has a search box over titles and briefs, and filters, as Claude desktop's home does.
- **Settle.** Rob can settle a brainstorm the way T3 Code settles a thread. It works the same way in both apps: what settling hides, where settled brainstorms go, how to unsettle one, and what brings one back on its own. The build observes T3's own behaviour first, and records it in an ADR.
- **History, fork and vary (Rob, 2026-11-06, chosen from the prototype in round 5).** Rob works in a tree: diverge, pick, fork, refine.
  - **History.** A filmstrip of iteration stills runs along the bottom of the canvas, and forks branch off it as labelled offshoots. A history toggle in the header collapses it, beside the right-panel toggle, and the state is remembered per viewer. Clicking a still shows that iteration read-only, with a "Viewing iteration N · Back to latest" bar.
  - **Fork.** A Fork button sits beside Regenerate. It reads "Fork iteration N" while you view the past. It opens an instruction box and lists what carries over: every slot narrowed to its picked variant, Rob's settings baked in as defaults, and his open pins on those variants. Send starts a new T3 thread on the same project and a new brainstorm linked to its parent and source iteration. Forks show flat on home, with "Fork of <parent> · iteration N". Inside a brainstorm the breadcrumb and the filmstrip show the lineage.
  - **Vary an element.** This is a pick mode beside Pin comment. Rob clicks an element, sets a count (default 3) and an optional direction, and sends. The agent returns new variants of that slot that differ only at that element, named after it.
- **No variant notes.** Variant notes are removed: the `about.md` file, its "Hypothesis", "Tradeoff", "Try this" and "Recommended" text, and More/Less, from the app, the working-copy format, the skill and the fixtures. This supersedes X2. Rob judges the designs himself, and the notes were padding. The skill still has the agent design around distinct hypotheses, but the agent doesn't write them up.

## Constraints

- The stack:
  - Electron 44
  - React 19
  - Tailwind 4
  - shadcn with Base UI primitives (base-nova)
  - lucide icons
- The renderer has no preload, and its CSP allows no remote fonts. Any font must ship in the bundle.
- The canvas iframe's contract with blocks doesn't change.
- No Radix in the renderer bundle. `verify:7` checks this.

## Enforcement

The climb's deliverable is a design system, not hand-tuned screens:

- Tokens for both themes.
- Closed scales for type, spacing, radius, shadow and z-index.
- Kit components with typed props.
- A design lint (`npm run lint:design`) with a test per rule that fails on:
  - off-scale classes
  - arbitrary values
  - raw colours in the renderer
- The capture script is part of the repo and reruns unchanged each round.

## Where it lands

The climb lands on branch `consistent-skill-html`, kept local, with one commit per component family. Rounds live in `design-review/round-<n>/`, which is gitignored. The score table for every round is committed in `docs/design-system/scores.md`.

## Checkpoint

There is one checkpoint with Rob, after the foundation phase: tokens, scales, accent and mark. He sees before and after shots of home, the brainstorm panel and one overlay, in both themes.

## Council

The council is Claude Opus 5.5, GPT-6.1 Sol and Claude Sonnet 5.5, all at high reasoning and all read-only. Each round's brief follows the `hillclimb-ui` reviewer template and carries the findings log.
