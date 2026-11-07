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

The block is laid out in its slot's declared frame, height included, as on the stage, so a short block whose own background fills its frame fills the card too, rather than leaving the page showing under it. A block that throws is cached as failed beside the stills, so home coming back shows the failure at once and never runs a frame only to take a still of the canvas's error box.

### States

- **Loading.** A skeleton fills the band until the still arrives.
- **No iteration yet.** "Waiting for the first commit" with an hourglass, quiet, so the band never looks broken.
- **Failed.** A block that fails to compile or render, or a frame that hasn't painted in 10 s, shows "The preview failed to render" with a danger icon, quiet beside the card's own status.
- **Thread lost.** The preview shows as usual: the design is still Rob's, and the card's status says the thread is lost.
- **Settled.** The preview is dimmed with the rest of the card.

### Checks

- `verify:2` holds a card's preview frame open and checks it shows the first slot's selected block with its real content and no canvas chrome, has an opaque origin, can't reach the parent document or the network, and is inert and hidden from assistive tech; that `/canvas/preview` carries the canvas CSP; that the still is a PNG with the block's colours and the frame is gone after; that a click on the preview opens the brainstorm; and that a block that throws shows as failed, and again when home comes back, with no frame run.
- `verify:7` checks every card settles to a still or the waiting note with no frame left running, that a short block in a 980 × 600 frame fills its still to the bottom, and that a settled card's preview is dimmed.
- `test/brainstorm.test.ts` (`preview`), `test/http.test.ts`, `test/canvasDocument.test.ts` and `test/previewQueue.test.ts` cover the payload, the route behind the UI token, the preview document and its CSP, the three-frame limit and the still cache.

## Search and filters

Home gains one row of controls under its heading, in the order Rob narrows a list: what he is looking for, which kind, from where, in what order. The row is the toolbar's height, 28 px, and wraps only in a window narrower than the app allows.

- **Search.** A field that filters as Rob types, over titles and briefs (the brief's text, its markdown stripped). Every word must appear, in any order and any case, so "bins wheel" finds a brainstorm whose title says wheel and whose brief says bins. `/` or `Ctrl+F` puts Rob in it from anywhere on home; `/` waits while he types in another field. The field shows `/` as its key. `Escape` clears it, and a second `Escape` leaves the field. Clear is also a button in the field once there is text.
- **Status.** A segmented switch: Active (the default, everything not settled), Attention, Settled and All. Attention is a brainstorm that has stopped for Rob: a lost thread, or a request in a status hue (asking, no change, previous thread, send failed, run failed), which is the same table the cards colour by (`src/renderer/status.ts`), so the filter and the dot never disagree. A settle still waiting on a request counts as active. Each segment shows how many it holds under the search and projects as they stand, so a segment never promises cards it won't show. While the first list loads, the segments carry no count, since none is known yet. Under All, the settled cards follow under their own heading, as before.
- **Projects.** A popover of every project with a brainstorm, each a checkbox with its count; none checked is every project. The trigger names the one project, or how many, and reads as pressed while it narrows. A project the stored filter names that has no brainstorm any more is ignored, so home is never empty by a filter Rob can't see. The list scrolls inside the popover when there are many projects.
- **Sort.** Last active (the default: activity, or when Rob brought it back; settled cards by when they were settled), Newest (created) or Title.
- **Kept.** Status, projects and sort are kept in `ui_pref` (`home.query`), so home comes back filtered as Rob left it. The search text isn't: it is a question for now, and a search remembered across launches would hide brainstorms with nothing on screen to say why.
- **Nothing to show.** When the search and filters leave nothing, home says "No brainstorms match" with one button, Clear search and filters, which empties the search, unchecks every project and goes back to Active, keeping the sort. When every brainstorm is settled and Rob is on Active with nothing narrowing it, home says "Every brainstorm is settled" with Show settled.
- **Calm and dense.** No chips, no result banner and no second row. The counts in the status switch are the only numbers, muted beside their labels.

The sidebar doesn't filter. It stays T3's list, every active brainstorm by project and the Settled group, so the search never hides where Rob is.

### Checks

- `test/homeQuery.test.ts`: search by title and by brief words in any order and case; Active by default with the counts; Attention is a lost thread or a request that stopped for Rob, never the agent at work; Settled newest settled first, and All with the settled apart; projects narrow every status and its count, and a stored project with nothing left is ignored; the three sorts; the counts follow the search; and the project list.
- `test/prefs.test.ts`: `home.query` survives a restart, a status it doesn't know or a stored search is refused, and a stored row in an unknown shape is skipped.
- `verify:7`: Active by default hides a settled card and counts it under Settled; `/` focuses the search; the search narrows by title and by brief words in any case, with the counts; no match shows Clear search and filters; `Escape` clears, a second leaves the field, and `Ctrl+F` focuses it; the project filter lists every project with its count and narrows to one; sorting by title reorders; clearing goes back to Active and keeps the sort; status, projects and sort survive a restart while the search starts empty; and no status shows a count while the first list loads.

## Amendment: round 8 fix pass. The settle action sits in its row

The settle hint opened off the row, and no side cleared both the row's title and home's search field (R5-4, R7-28, R8-12). Left covered the title of the brainstorm it settles. Right covered the search field on the top rows. Above or below covered a neighbouring row. So the overlay is gone. Hovering or focusing a row shows the action in the row, in the age's place, as T3 Code shows a thread row's actions: the settle glyph and its name, "Settle" or "Un-settle". The row holds the action's room while it shows, so the title gives way to it rather than run under it. The chord is in the action's accessible name, "Settle Kitchen rota, Ctrl+Shift+S", and in `aria-keyshortcuts`. A card's settle control on home keeps its hint, since it opens inside the card. `verify:7` reads the action's name, height and accessible name, checks the title ends before it, and hovers the top row's action to check that no hint opens, that the action stays inside its row, and that home's search field is still what sits under its corners.

## Amendment: round 8 fix pass. Home's quiet states

- **No match names the search.** "No brainstorms match" sat over "No brainstorm matches the search.", which only repeated it (R8-23). The line now names the search's own words: "No brainstorm has “zebra” in its title or brief." It still names a status or picked projects only when they narrow the result. `vocabulary.test` retires the old line, and `verify:7` reads the new one.
- **A settled still is a ghost.** In light, a settled card's still faded to 50% and kept a dark ground that read as a mid-grey slab, the heaviest thing on the page (R8-20). It now fades to 35% in light, still grey, and keeps dark's 50% with its dimming. `verify:7` reads 0.35.
- **A lost thread shows amber once.** Home showed "Thread lost" in warning amber on the sidebar row and on its card (R8-35). By R6-7 a status hue shows once and echoes muted. The card keeps the amber, since that is where status is read and what Attention matches. The row's triangle and words go muted. `verify:7` compares both colours with `fg-muted`.
- **A card's settle button takes its card's surface.** The outline settle button kept the resting card fill inside a hovered dark card, a darker square punched into the lift (R8-32). It is a ghost icon button now, so it shows the card it sits on and takes the hover fill under the pointer, as the sidebar's settle action does. The kit's outline fill stays, since every header and filter button relies on it. `verify:7` reads no fill on the button inside a hovered card.
- **The Active chip stands.** SB8-3 read the pressed Active chip as faint in dark. Measured, the chip is 19.16 CIEDE2000 off its track, and 21.40 with this round's tokens. It differs from the Inspector's chips only in weight, which `fit="content"` holds so a press moves nothing (R8-34).

## Amendment: round 9 fix pass. Home keeps its frame, and a settled still loses its colour

- **A notice stays until Rob closes it.** Every server event refreshed the list, and the refresh cleared whatever notice was up, so an export failure could vanish before Rob read it (R9-1). A refresh now clears only the notice it raised itself. `verify:7` re-attaches a thread through the CLI, waits for the refresh, and checks the notice is still up. The capture fails a shot whose subject is gone once it settles.
- **A fresh install keeps the page's frame.** The empty home dropped its subtitle and its query row, so its message sat 70 px higher than in every other state (R9-12). It now keeps both, the row off at the disabled opacity, as a failed home does. The message no longer repeats how to start, since the subtitle says it. `verify:7` answers an empty list and checks the subtitle, the row's place and its inert state.
- **Skeletons match what lands.** The sidebar's skeleton showed one group head where three land (R9-7). It now shows three project groups. A card's frame skeleton was translucent, so the mat's dots showed through it (R9-8). It now pulses on the card's fill. `verify:7` counts the heads and reads the frame's fill while the list loads.
- **No match opens on another word than its title.** "No brainstorms match" sat over "No brainstorm has …" (R9-16). The line now opens "Nothing", as in "Nothing here has “zebra” in its title or brief." `verify:7` reads it.
- **A settled still is greyed, not faded.** Opacity let the mat's dots print through the still in dark, and in light its dark ground read as a grey slab (R9-10). The still is now opaque on the card's fill. It takes `grayscale` and a reduced contrast, lifted toward the card in light and sunk toward it in dark. `verify:7` reads opacity 1 and the filter, and samples the still's pixels in both themes. In light no pixel is darker than 150, and in dark none is lighter than 120.
- **One control for settle, named in both places.** A card's settle control was a bare circle-check, the glyph a settled card shows as its status (R9-29). It now names itself at the row action's size, 24 px with the glyph and "Settle" or "Un-settle". `verify:7` reads both controls' words, height and type size.
- **The row's Settle ends on the ages' edge.** Its words ended 2 px short of the ages (R9-11). The labelled action takes 4 px on its right, not 6, so its words end on the ages and its fill keeps 4 px off the row's end, as off its top. SC9-4 read 2 px at the end, but measured it was already 4. `verify:7` reads both.
- **A card names its fork's parent with the session's word.** The card said "Fork of Rota handover · iteration 3" where the session says "from" (R9-18). It now says "from" behind the branch mark. `verify:8` reads it.
- **The header counts a running request's time.** The sidebar showed "Agent working 12s" while the header showed only "Agent working" (R9-20). The header now counts the time too, and gives it up first when its breadcrumb runs short. `verify:9` reads it at 1440 for every phase that counts.
- **The mark holds still.** With the sidebar open the mark sat 8 px after the toggle, and with it collapsed 12 px, so Ctrl+B nudged it 4 px (R9-13). The header now groups the toggle and the mark with the sidebar's own gap. `verify:7` reads the mark's x on both sides of the toggle.

## Amendment: Rob's ruling on round 6. A page-width still keeps half its size

A card's still scaled the frame to the card's width, so a 980 px frame in a 240 px well became a band of 2 to 3 px text (R6-64). Rob ruled on 2026-11-07 that a still has a scale floor and crops from the top left past it.

- **The floor is 0.5.** `CARD_FLOOR` in `src/renderer/Preview.tsx` is the least zoom a card's still takes. A frame that fits the well at 0.5 or more keeps its fit, 12 px in from either side, so a 390 px phone frame shows whole as before. A wider frame stays at 0.5 and shows its top left, about the left 500 px of the page at 1440, with 14 px text at 7 px.
- **A cut frame runs off the well's right edge**, as every frame already runs off its bottom, so the cut reads as more page to come and not as the frame's end. A frame that fits at 0.5 only once it takes the right inset too shows whole at 0.5 with a narrower inset.
- **One rule on both sides of the frame.** The host passes the floor in the preview's `state` message, and sizes the frame's box with `min(100% - 12px, max(100% - 24px, width × floor))`. The preview zooms to `max(its width ÷ the frame's width, floor)` and takes its still of what that zoom shows. Strip stills pass no floor, so a wide frame still shows whole in a strip entry.

`verify:7` gives the wide frame a 200 px mark at its top left and reads it in the card's still, in light and dark. The mark starts at the still's left and reads 100 px, and the frame runs off the well's right edge. The phone frame stays 12 px in from either side. On the old fit the mark read 49 px.
