# ADR 003: The app draws its own window header

Status: accepted. Rob asked for it on 2026-11-06, during the round 2 fix pass, with T3 Code as the reference (`design-review/exemplars/t3/thread-dark.png`).

## Context

The window had the stock Windows title bar: a 40 px strip in the system accent colour that said "Brainstorm" a second time above the sidebar's own "Brainstorm", and held nothing else. Under it, the session top bar sat inside the inset card. So the top of the window spent 88 px on two bars, and the title bar's colour matched neither theme.

T3 Code has no system title bar. Its top row is the app's own: the sidebar toggle and the app name over the sidebar, then the breadcrumb, then panel toggles at the right, just before the native minimise, maximise and close buttons.

## Decision

### Frameless, with the native buttons kept

The window uses `titleBarStyle: "hidden"` and `titleBarOverlay`, so Windows still draws its own minimise, maximise and close buttons, with their snap layouts and keyboard behaviour, over the right end of the app's header. The overlay is 48 px tall, the header's height. Its colour is the `app` token and its symbols the `fg` token for the current theme, read from `solidColours()` in `src/core/design.ts`, the same source as every other colour.

When the OS theme changes, `nativeTheme` emits `updated` and the main process calls `setTitleBarOverlay` with the other theme's tokens. The page follows `prefers-color-scheme`, which Electron ties to the same setting, so theme sync needs no IPC and the renderer keeps its no-preload rule.

The minimum window size is 1100 × 720, the smallest size the brief designs for.

### The session top bar becomes the header

The session top bar moves out of the inset card and becomes the window header, on the app background at the window's top edge. A second bar under the header would repeat the 88 px problem, and the top bar's breadcrumb, iteration and request phase are what a window title should say anyway.

- **Left, over the sidebar.** The sidebar toggle, then the mark and "Brainstorm". When the sidebar is hidden, the toggle moves to the start of the header, as before.
- **Middle.** The breadcrumb, the iteration badge and the request phase, unchanged.
- **Right.** Regenerate and Export, then the right panel toggle, which collapses the Inspector to its rail and back (X4). It is pressed while the Inspector shows, as T3 Code marks an open panel. It replaces the Inspector toggle that was at the end of the canvas bar, so there is one control for one action.
- **Room for the native buttons.** The header's right padding is the width the browser reports outside the titlebar area (`env(titlebar-area-x)` and `env(titlebar-area-width)`), so the last control never slides under the overlay at any width or scale. Without an overlay, in a browser, it falls back to 12 px.

The request strip (send failed, thread lost, no change) stays at the top of the card, under the header, because it belongs to the page, not the window.

### Labels give way one at a time, only when the title needs the room

Round 6 added 2026-11-07. A container query at 960 px used to turn every session action into an icon at once. At 1100 the title then kept room it didn't need while Open thread and Retry lost their names. At 1440 nothing gave way, however long the title, so "Chore roulette" read "C." with a request asking.

The header now measures. `useHeaderFit` in `headerAction.ts` runs after each layout and whenever the header, its actions or its title change size. It restores every label, then takes them back one at a time until the title holds 160 px (or reads whole) and each ancestor in a fork's breadcrumb holds 64 px. The order is fixed by `COLLAPSE`:

1. the status's long words, which give way to the phase's short name ("Agent asking")
2. Export
3. Fork
4. the phase actions, from last to first, so the phase's recovery (Retry, Resend) keeps its name longest

A collapsible part carries `data-collapse` with its rank, and a collapsed one `data-collapsed`, which the `data-collapsed:` and `in-data-collapsed:` variants style. Rules:

- The title shows whole whenever the header has room for it with every label.
- A label goes only when the title would otherwise drop under its floor.
- No label goes while there is room for it.

`verify:9` proves this in every request phase, with a short title, a long one and a fork breadcrumb, at 1440 and 1100, in both themes. For each state it restores the last label that gave way and checks the floors then break, so nothing gave way early.

Rejected: a second header row for the status. It costs the canvas 40 px in every state to fix the few that crowd, and it moves the actions between rows as a phase starts and ends.

### Moving the window

The header and the sidebar's header row carry `data-drag-region`, which sets `-webkit-app-region: drag`. One CSS rule gives every link, button, input, tab and focusable element inside a drag region `no-drag`, so a control added to the header later can't turn into a drag handle by accident.

## Consequences

- Page screenshots stop at the web contents and can't show the native buttons. The capture's `window-title-bar` shot is taken from the screen instead, of a window with no viewport emulation, sized and themed through Electron.
- `verify:7` checks that the header and sidebar header drag and every control in them doesn't, that the Inspector toggle sits in the header, that the overlay leaves the last control clear, that the page fills the window's content area after two resizes, and that the window stops at 1100 × 720.
- A white band at the right and bottom of a window comes from Playwright's viewport emulation in a capture or verify run, which pins the page to 1440 × 900 inside whatever the window is. A real launch, and the verify check above, track the window.

## Rejected

- **Keeping the top bar inside the card, under a thin drag strip.** Two rows again, with the strip holding only the native buttons.
- **Custom-drawn window buttons.** They would lose Windows' snap layouts and its own hover and press behaviour.
- **A preload to send theme changes to the renderer.** `nativeTheme` and `prefers-color-scheme` already agree, and the window-security rules forbid a preload.

## Amendment: round 6. Header hints stand off the row and never cut the breadcrumb

Header hints still open left of the whole right cluster and its request status (R5-3), so none covers a control or the status. Round 6 found two faults with that placement. A hint stood 6 px off the row, closer than the row's own 8 px gap between buttons, so it read as one more chip beside Fork (R6-22). A long hint ended partway into the breadcrumb, leaving "cho" of the project showing (R6-23).

A hint off the header row now stands 12 px out. The header also tells its hints where its breadcrumb and badge run. A hint that would end inside that text widens to cover it from the breadcrumb's first ink, with its words kept against the row. A hint that clears the text is unchanged. `verify:5` checks the blocked Regenerate's hint stands 12 px off the row and covers the breadcrumb from its start.

## Amendment: round 7. A hint says whose it is, and a sidebar row fits as the header does

Opening off the whole row kept hints off the controls, but it put the blocked Regenerate's hint about 570 px from its button, and the plain one beside Fork, where it read as Fork's (R7-13, R7-32). Hints below their buttons would sit near them, but the header's lint rule opens them to the side, so that change is Rob's to make. Every header hint now leads with its control's name instead. The offset off the row now stops where the covered text ends, so a hint over the breadcrumb leaves no sliver of the Iteration badge. The sidebar's settle hint covered or cleared its row's title the same way, until round 8 opened it right (ADR 001). `verify:5` reads the name and the badge's cover.

A sidebar row's status gave way last, so a fork's title fell to six letters in the 240 px sidebar (R7-2). The row now measures its title as the header does. The status folds its words first, leaving the dot and the time, so the title keeps 112 px. `verify:8` checks the row at 1440 and 1100.

## Amendment: round 8. Every phase's short name is shorter than its words

Round 7 gave the previous thread "Sent to the previous thread" as both its short name and its header words (R7-20), so folding the status saved nothing. At 1440 with a short title the header gave up Export, Fork and Withdraw rather than the status. Its short name is now "Previous thread", which the header words hold. The status folds first, by rule 1 above, and only Export gives way after it. `status.test` holds each row name inside its header words, and `verify:9` reads the previous thread's give-way as status, then Export.
