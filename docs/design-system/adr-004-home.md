# ADR 004: Home settles, previews, searches and filters

Status: accepted. Rob asked for it on 2026-11-06, after round 4: "I'd also like to be able to settle brainstorms just like t3 settles threads", and "Previews and search. It should also have filters." It supersedes worklist items Y1, Y4, T25 and X2.

## Context

Home lists every brainstorm Rob has ever started. With a few dozen, the ones he is done with crowd the ones he is working on, and a card says nothing about what the brainstorm looks like. T3 Code has the same problem with threads and answers it with settling, so Brainstorm takes T3's model rather than inventing an archive. The reference is T3 Code as installed, observed on 2026-11-06 with two of its own test threads (both settled again afterwards), and its server bundle (`resources/server.asar`).

## Settle

### What T3 does

- **What it hides.** A settled thread leaves the active list. Nothing is deleted: the thread, its turns and its worktree stay, and opening it works as before.
- **Where it goes.** The sidebar ends with a "Settled" group below Working and Snoozed. It is shut by default and its header always shows the count. Its rows are newest settled first, one muted line each: a dimmed project mark, the title, and how long ago it was settled.
- **How to settle and bring back.** Hovering a row shows Settle (a circle check) in place of its age, or Un-settle (an undo arrow) on a settled row. The context menu has "Settle thread" and "Un-settle thread". The keyboard chord is `mod+shift+s` (`thread.settle`). A thread can also be dragged onto the Settled header.
- **Bringing back.** Un-settling clears `settledAt` and stamps the thread as updated now, so it lists at the top of the active list while its row still shows the age of its last turn. Settling a thread that is already settled keeps its first `settledAt`.
- **What brings a thread back on its own.** Any new activity: a new turn or message, a guest message, pinning it. The settings say "Any new activity un-settles a thread automatically". A settle during a running turn applies when the turn ends, and a turn that fails, or a queued message, leaves the thread active.
- **What T3 does that Brainstorm doesn't.** T3 also settles a thread after three idle days by default (`sidebarAutoSettleAfterDays`, a setting) and when its pull request merges.

### What Brainstorm does

- **Data.** `session.settled_at` and `session.unsettled_at` (migration 5) are Rob's rows, written only through `POST /v1/ui/sessions/:id/settle` with `{ settled }` behind the UI token. The listing carries `settlement`: `active` (with `unsettledAt`), `settling` or `settled` (with `at`). Whether a settle still holds is derived on read, in `settlementOf`, so no other writer has to remember to clear it.
- **What brings a brainstorm back.** Brainstorm's turn is a request and its answer. A settle is undone by a request Rob makes after it (Regenerate), or by an agent commit that doesn't answer a request made before the settle. That is T3's "any new activity".
- **Settling during a request.** With a request open, the settle is `settling`: the brainstorm stays in the active list, as T3's thread stays until its turn ends. The commit that fulfils the request settles it. A failed send or run keeps the request open, so the brainstorm stays in view, as T3 keeps a failed turn's thread active. One divergence: if Rob withdraws the failed request, the settle then applies, where T3 would have cleared it. Withdrawing is Rob saying he is done, so the settle he asked for stands.
- **Sidebar.** Active brainstorms stay grouped by project. A "Settled" group follows the last project, shut by default, with its count always showing. Its rows are newest settled first, muted, with the age since the settle. They carry no project mark, since Brainstorm has none; the row opens the brainstorm, whose header names the project.
- **Overview.** Settled cards follow the active ones under a "Settled" heading with the count. A settled card is muted, says "Settled" where a status sits, and its footer counts from the settle.
- **Controls.** Hovering or focusing a sidebar row swaps its age for Settle or Un-settle, as in T3. A card shows the same control over its bottom right corner on hover or focus; it is a sibling of the card's button, since a button can't hold another. Each control's hint names T3's chord. `Ctrl+Shift+S` settles or brings back the brainstorm focused in a list, or else the one open, and does nothing with neither, so it never settles one Rob can't see. Un-settling lists the brainstorm first among its project's, while its age stays that of its last activity.
- **No context menu and no drag.** Brainstorm has no context menus anywhere, and its rows don't drag. The hover control and the chord cover both.
- **No auto-settle.** Brainstorm doesn't settle on its own after idle days or on any other event. Rob asked for the action, not the policy; an automatic settle hides work without Rob acting, and in T3 it is a setting. If Rob wants it, it is one rule in `settlementOf` and one preference.

### Checks

- `test/brainstorm.test.ts` (`settle`): settling keeps the iteration, the view and the pulled files; a second settle keeps its time; un-settling records when; a Regenerate and an unprompted commit each bring it back; a settle during an open request waits through a failed run and lands with the commit that fulfils the retry; a settle survives a restart.
- `test/http.test.ts`: only the UI token settles, and a body without `settled` is refused.
- `test/sessionGroups.test.ts`: settled brainstorms leave the active list newest settled first, a `settling` one stays, and one brought back lists first.
- `verify:7`: the hover swap and the hint, the Settled group shut with its count, the overview's Settled section, the muted row and its age, the chord on a focused row both ways, a card's own control both ways, and a settle that survives a restart.

## Previews

Each overview card opens with a preview of the brainstorm: the latest iteration's first slot, showing the variant Rob has selected, with his settings applied. It fills the 160 px band T25 left at the top of the card, scaled to the card's width from the top, since every frame is a page that starts at its top. The band is there on every card, so rows keep one height.

### Security

A preview runs agent code, so it runs exactly as the canvas does. `/canvas/preview` is the canvas document in a third mode, under the same CSP header, in an iframe with `sandbox="allow-scripts"` and nothing else, so its origin is opaque. Its data comes by postMessage only: the renderer fetches `GET /v1/ui/sessions/:id/preview` with the UI token and posts `modules` and `state`, as the canvas host does. In preview mode the runtime draws the one block with no frame title, variant switch, pins, pick or key forwarding, and its page takes no pointer events. The iframe is `inert`, out of the tab order and under `aria-hidden`. Nothing in it can be pressed: the card's title is its button, stretched over the whole card, so a click on the preview opens the brainstorm. `npm run lint:design` fails any iframe in the renderer that isn't a canvas page under that sandbox (`frame-sandbox`).

### Stills, three frames at a time

Each preview frame is a page with its own copy of React. Two ways to show many were built and measured:

- **Live frames.** Every card in view keeps its frame running, and a card that leaves the view drops it.
- **Stills.** A card in view takes a turn, at most three at once. Its frame draws the block, then takes a still of itself: its DOM and styles go into an SVG `foreignObject`, which a canvas draws and reads back as a PNG without being tainted, so the still needs no privilege the frame lacks. The frame posts `painted { image }` and is removed, and the turn passes on. Stills are kept by block hash, settings, frame width and theme, so a card scrolled back to, or a theme switch back, shows at once.

Measured on 2026-11-06 in Electron 44 with 24 brainstorms, each with its own block content, 12 cards in view at 1440 × 900, two runs each. Memory is private bytes summed over the app's processes, after the previews in view had painted.

| | Memory | Idle CPU | 12 cards painted | 12 more after a scroll |
| --- | --- | --- | --- | --- |
| No previews | 314 MB | 0.4% | | |
| Live frames, 12 running | 418 to 436 MB | 0.5 to 0.6% | 287 to 436 ms | 191 to 197 ms |
| Stills, 3 frames at a time | 441 to 463 MB | 0.5 to 0.6% | 556 to 635 ms | 348 ms |

With the demo's blocks, which sit still once drawn, the two cost the same memory and CPU; the frames share one sandboxed process of about 70 MB, which stays once the last frame goes. Live frames paint about 250 ms sooner. Stills are the choice anyway, because their cost doesn't depend on the blocks or the window. A live frame keeps its block running, so every timer, animation or canvas loop in a block costs CPU for as long as its card is in view, times the number of cards a large window shows. Stills run three frames at most, each for under a second, whatever the blocks do and however big the window is. The 250 ms sits under the loading skeleton, and a still from the cache shows at once (12 cards in about 30 ms).

If a still fails, the card keeps its live frame, and gives its turn back, so one block that can't be drawn into an image still shows.

### States

- **Loading.** A skeleton fills the band until the still arrives.
- **No iteration yet.** "Waiting for the first commit" with an hourglass, quiet, so the band never looks broken.
- **Failed.** A block that fails to compile or render, or a frame that hasn't painted in 10 s, shows "The preview failed to render" with a danger icon, quiet beside the card's own status.
- **Thread lost.** The preview shows as usual: the design is still Rob's, and the card's status says the thread is lost.
- **Settled.** The preview is dimmed with the rest of the card.

### Checks

- `verify:2` holds a card's preview frame open and checks it shows the first slot's selected block with its real content and no canvas chrome, has an opaque origin, can't reach the parent document or the network, and is inert and hidden from assistive tech; that `/canvas/preview` carries the canvas CSP; that the still is a PNG with the block's colours and the frame is gone after; and that a click on the preview opens the brainstorm.
- `verify:7` checks every card settles to a still or the waiting note with no frame left running, and that a settled card's preview is dimmed.
- `test/brainstorm.test.ts` (`preview`), `test/http.test.ts`, `test/canvasDocument.test.ts` and `test/previewQueue.test.ts` cover the payload, the route behind the UI token, the preview document and its CSP, the three-frame limit and the still cache.

## Search and filters

Home gains one row of controls under its heading, in the order Rob narrows a list: what he is looking for, which kind, from where, in what order. The row is the toolbar's height, 28 px, and wraps only in a window narrower than the app allows.

- **Search.** A field that filters as Rob types, over titles and briefs (the brief's text, its markdown stripped). Every word must appear, in any order and any case, so "bins wheel" finds a brainstorm whose title says wheel and whose brief says bins. `/` or `Ctrl+F` puts Rob in it from anywhere on home; `/` waits while he types in another field. The field shows `/` as its key. `Escape` clears it, and a second `Escape` leaves the field. Clear is also a button in the field once there is text.
- **Status.** A segmented switch: Active (the default, everything not settled), Attention, Settled and All. Attention is a brainstorm that has stopped for Rob: a lost thread, or a request in a status hue (asking, no change, previous thread, send failed, run failed), which is the same table the cards colour by (`src/renderer/status.ts`), so the filter and the dot never disagree. A settle still waiting on a request counts as active. Each segment shows how many it holds under the search and projects as they stand, so a segment never promises cards it won't show. Under All, the settled cards follow under their own heading, as before.
- **Projects.** A popover of every project with a brainstorm, each a checkbox with its count; none checked is every project. The trigger names the one project, or how many, and reads as pressed while it narrows. A project the stored filter names that has no brainstorm any more is ignored, so home is never empty by a filter Rob can't see. The list scrolls inside the popover when there are many projects.
- **Sort.** Last active (the default: activity, or when Rob brought it back; settled cards by when they were settled), Newest (created) or Title.
- **Kept.** Status, projects and sort are kept in `ui_pref` (`home.query`), so home comes back filtered as Rob left it. The search text isn't: it is a question for now, and a search remembered across launches would hide brainstorms with nothing on screen to say why.
- **Nothing to show.** When the search and filters leave nothing, home says "No brainstorms match" with one button, Clear search and filters, which empties the search, unchecks every project and goes back to Active, keeping the sort. When every brainstorm is settled and Rob is on Active with nothing narrowing it, home says "Every brainstorm is settled" with Show settled.
- **Calm and dense.** No chips, no result banner and no second row. The counts in the status switch are the only numbers, muted beside their labels.

The sidebar doesn't filter. It stays T3's list, every active brainstorm by project and the Settled group, so the search never hides where Rob is.

### Checks

- `test/homeQuery.test.ts`: search by title and by brief words in any order and case; Active by default with the counts; Attention is a lost thread or a request that stopped for Rob, never the agent at work; Settled newest settled first, and All with the settled apart; projects narrow every status and its count, and a stored project with nothing left is ignored; the three sorts; the counts follow the search; and the project list.
- `test/prefs.test.ts`: `home.query` survives a restart, a status it doesn't know or a stored search is refused, and a stored row in an unknown shape is skipped.
- `verify:7`: Active by default hides a settled card and counts it under Settled; `/` focuses the search; the search narrows by title and by brief words in any case, with the counts; no match shows Clear search and filters; `Escape` clears, a second leaves the field, and `Ctrl+F` focuses it; the project filter lists every project with its count and narrows to one; sorting by title reorders; clearing goes back to Active and keeps the sort; and status, projects and sort survive a restart while the search starts empty.
