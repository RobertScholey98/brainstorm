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
