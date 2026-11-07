# ADR 005: History, fork and vary

Status: accepted. Rob chose design B from the round 5 prototype on 2026-11-06, and `shell-brief.md` records what he asked for: "Rob works in a tree: diverge, pick, fork, refine."

## Context

Every commit makes an iteration, and until now Rob could see only the latest. To go back to something he liked, he had to ask the agent to rebuild it. To try two directions from one point, he had to pick one, so the other was lost. And to explore one element, such as a button, he had to ask for whole new variants and compare them by eye for the part he cared about.

Three features answer this. History shows every iteration. Fork starts a new brainstorm from one of them. Vary asks for variants that differ at one element only.

## History

- **Data.** Iterations were already stored whole, with their blocks addressed by content hash, so history needs no new storage for what an iteration showed. `SessionView.history` lists each iteration's `n`, `createdAt` and `origin`, plus the forks made from this brainstorm. The origin is derived on read from what is already stored. An iteration is `brief` when it is the first one and nothing asked for it, `fork` when it is a fork's iteration 1, `request` when it fulfilled one of Rob's requests (with that request's body and, when he gave no words, the titles of the blocks the iteration changed), and `agent` otherwise (with its commit note). Nothing has to remember to write it.
- **Reading one.** `GET /v1/ui/sessions/:id/iterations/:n` returns that iteration as an `IterationView`, and the preview route takes `?n=&slot=`. Both are read-only. No route writes to a past iteration.
- **The strip.** It runs along the bottom of the canvas with one still per iteration, oldest first. It is 84 px tall whatever it holds, so the stage keeps one height as a brainstorm grows forks. Each entry is a 64 by 48 px landscape still on the canvas mat, then two lines beside it: its number, "latest" on the newest one and its age, then its origin. The origin is Rob's own words when he gave some, otherwise the blocks the iteration changed ("Neon wheel and Assignment card"), and a fork's first iteration reads "Your picks from iteration N". The forks made from an iteration follow its still in the same row as dashed links, each to its brainstorm. The overflowing edge fades (`scroll-fades-x`), so a still cut there reads as more to come. While a view loads, a skeleton strip holds the place, so the canvas doesn't jump when it lands. Inside a fork, the strip starts with a stub, "from <parent> · iteration N", that opens the parent, or reads "discarded" when the parent is gone. The strip is one listbox. Left and Right step through it, Home and End jump to the ends, and the option Rob lands on is what the canvas shows. It scrolls sideways and keeps the shown still in view.
- **Stills.** Stills use ADR 004's pipeline unchanged. The same sandboxed `/canvas/preview` frame draws them, at most three at a time, and they are cached by block hash, settings, width and theme. So a strip with many iterations costs what home's cards cost. A still shows the slot on the stage, so it matches the canvas.
- **The toggle.** It sits in the header beside the right panel toggle, and is pressed while the strip is open. Its state is the `history.strip` row in `ui_pref`, so it survives a restart, and it defaults to open. A brainstorm with no iteration yet has no strip, so the toggle is off there with a hint saying why, and never reads pressed.
- **The past.** Clicking a still shows that iteration on the canvas under a "Viewing iteration N · Back to latest" bar. The header badge then reads "Iteration N of L". In the past:
  - Regenerate and Vary are off, and their hints say to go back to latest.
  - Fork reads "Fork iteration N".
  - The Inspector shows the controls, inert, under a note that the settings belong to the latest iteration.
  - The canvas draws no pins, since pins belong to the latest iteration.
- **Picks in the past.** Rob can switch variants while looking at the past. These picks are kept in the renderer, apart from the stored `select_variant` picks, so history never changes and the latest iteration keeps its own picks. They exist so he can fork the past with the variants he chose there.
- **Leaving the past.** Escape goes back one layer: an open popover closes first, then a pick, then the past. Back to latest, Escape, or End on the strip returns to the latest iteration.

## Fork

### The data

- **Tables.** Migration 6 adds `fork(session_id, parent_id, from_n, baked)` and `variant_seen`. The fork row is the only record of lineage. `SessionView.fork` names the parent, its state (`active`, `settled` or `gone`) and the iteration it came from. `SessionView.lineage` lists the ancestors, oldest first, and the listing carries `fork` for home.
- **What a fork starts with.** Its iteration 1 is the source iteration narrowed to one variant per slot:
  - **Variants.** Each slot keeps the variant Rob picked (`picks`), or the one that was showing.
  - **Settings.** Rob's settings on those variants are written into each `block.json` as the props' new defaults (`bakeDefaults`), so the fork starts with no overrides and its blocks look as they did. A setting whose prop is gone from that iteration's block is left out.
  - **Pins.** Rob's open pins on those variants are copied as open feedback.
  - **Shared rule.** `carryOver` in `src/core/fork.ts` computes all three. The popover's "Carries over" list and the service use the same function, so the list always matches what the fork gets.
- **Checking the result.** A baked block goes through the check worker again. If Rob's settings make a variant fail to compile or render, the fork is refused with a message that names the setting, and nothing is saved. When the canvas has already failed a carried variant, the popover warns first.

### Starting the thread

- **The facts.** `t3 thread start --title <t> --json <project> -` reads the first message from stdin and prints `{ threadId, projectId, title, ... }`. It was observed with T3 0.1.8-nightly.20261104.4179, and `docs/t3-cli.md` records the exact behaviour. The title goes through `safeTitle`, which keeps it to one line under T3's limit.
- **The sequence.** The fork is saved first. It is attached to a placeholder thread, `pending:<session>`, which the bridge refuses to use, so nothing can ever be sent to it. Its request 1 (scope everything, free text set to the instruction, feedback set to the carried pins) is then the first message of `bridge.start`.
- **Adopting the thread.** `#adopt` attaches the fork to the thread that was started, and is idempotent. Three paths call it:
  - a start that returns
  - a Retry, or a check at startup, that finds the thread. These list the project's threads made from 60 s before the request and look at the newest 10 for the request's marker.
  - the agent running `brainstorm session attach`

  If the start reply is lost after T3 has made the thread, the next look finds it rather than starting a second one. Startup reconciliation never starts a thread; it only looks.
- **Failure.** While it runs, the request phase is "Starting a T3 thread". If the start fails, the phase is "Couldn't start a T3 thread (<error>). The fork is saved." with Retry and Discard fork. Withdraw is refused on a pending fork, because the request is the reason the fork exists. Discard archives the fork and opens its parent.
- **Refusals.** A fork is refused when:
  - the parent is settled ("Un-settle it to fork it")
  - the parent is gone
  - the parent has no such iteration
  - a pick names a variant the iteration doesn't have
  - the instruction is empty
  - a variant fails to compile, as above

### The first message

The first message is the `[brainstorm]` message for the fork's request 1, with one more segment and a different run line:

```
[brainstorm] session <fork> · request 1 · fork of <parent> iteration <n> · scope: all · feedback: #1 · freetext: "<instruction>"
Handle with the use-brainstorm skill: this thread is new, so run `brainstorm session attach <fork>`, then `brainstorm context <fork>`.
```

T3 starts the new thread's agent with T3's own environment, so when the app runs on a home other than the default, a third line names `BRAINSTORM_HOME`. Only a fork's first message carries that line. A thread that made its own brainstorm already knows its home. `brainstorm context` on a fork adds `fork of <parent> "<title>" iteration <n>` and a `baked default` line for each baked setting. That tells the agent that iteration 1 is Rob's pick, and that it should build from there rather than start over.

### Where forks show

- **Home.** Forks show as ordinary brainstorms in their project's group. A card or row has a "from <parent> · iteration N" line and a branch mark.
- **The breadcrumb.** It shows the lineage between the project and the title, with each ancestor a link. A long line keeps the nearest two ancestors and folds the rest into an ellipsis whose hint names them.
- **The parent's strip.** The fork hangs off the still it came from. The fork's own sidebar has a "Forked from" link under its thread.

## Vary

- **The request.** Vary is a request scope, `{ kind: "vary", target: Pin, variants: [{ key, title }] }`. The target has the same shape as a feedback pin, a block and an optional `data-part`, and is picked the same way. The request shares Regenerate's lifecycle: one open request at a time, the same phases, and the same gate. The direction is the request's free text. Its marker reads `scope: vary wheel/neon [spin-button] as spin-button-a, spin-button-b, spin-button-c`.
- **Names.** `varyNames` names the new variants after the element, such as `spin-button-a` titled "Spin button A". It skips letters already taken, so a second vary of the same element goes on to `-d`. A whole-block target is named after the block's variant. Because the service picks the names, the commit can be checked against them.
- **What the agent is told.** `brainstorm context` lists the slot, the target and its part, each new variant's key and title, and "keep every existing variant as it is". The target block's overrides are in scope, so the agent copies the variant as Rob sees it.
- **Checking the commit.** A commit that answers a vary request warns `out_of_scope` when it changes any block other than the named new variants. It warns `vary_mismatch` when:
  - a named variant is missing
  - a variant's title differs from its name
  - a variant lacks the target part
- **New until viewed.** New variants land in their slot marked "new". A variant stops being new once it has been on the canvas for 1.5 s, on the stage or anywhere on the board. The renderer then sends `mark_seen`, and `variant_seen` stores it per block, so it survives a restart.
- **The UI.** Vary is a row in the Inspector above Feedback, with a "Vary element" button. Picking reuses pin mode's machinery, with its own hint in the canvas bar, "Click an element to vary". The popover opens where Rob clicked, as the pin composer does. It has a stepper for how many (1 to 6, default 3), an optional direction field, and Send, and its footer says which slot the variants land in. Escape ends the pick, or closes the popover without sending.

## Alternatives not taken

- **History as a list in the sidebar.** The sidebar already lists slots and variants, and a list of text can't show what an iteration looked like. The prototype's sidebar version lost to the strip.
- **Forking into the same brainstorm as a branch.** One brainstorm with branches would need branch-aware requests, pins and settings everywhere. A fork as a new brainstorm reuses everything, and the lineage is one row.
- **Forking without a thread, attached later.** A fork no agent is working on is a dead end. Starting the thread is the point, so the fork waits in `starting` until it has one, and is saved so a failed start loses nothing.
- **Vary as a Regenerate scope.** It is a request like the others, but its target is an element, picked the way a pin is. Putting it in Regenerate's menu would need a picker inside a popover. Beside Pin comment, it uses the pick Rob already knows.

## Checks

- `test/fork.test.ts`: `carryOver`, `bakeDefaults`, `forkTitle` and `varyNames`.
- `test/brainstorm.test.ts` (`fork`, `vary`, `history`):
  - a fork's narrowed slots, baked defaults and carried pins
  - the start, and a lost start reply found by its marker without a second start
  - retry and discard, and that startup never starts a thread
  - the refusals
  - the home line only in a fork's first message
  - vary's names, warnings and seen marks
  - each iteration's origin
- `test/machines.test.ts`: the pending phases, the fork message and the vary scope text. `test/bridge.test.ts`: `start`, `list` and `safeTitle`.
- `verify:8` (`scripts/verify/8-history.mjs`), with the fake T3:
  - the strip and its stills, and the past read-only with Back to latest
  - a pick in the past leaving the latest pick alone
  - the strip's keys, and Escape in each mode
  - the toggle surviving a restart
  - a fork from the latest iteration: one thread start in the parent's project, the exact first message, narrowed slots, the baked default in `block.json`, and the carried pin
  - the fork's lineage, stub and offshoot, and home's "Fork of" line
  - a vary request's exact marker and context, the new variants landing marked new, and the mark clearing once one is seen
- `verify:live`: one fork against the real T3, which starts a real thread.

## Amendment: round 7. The strip rests on whole entries

The strip could rest with an entry cut at either end, its origin ending on a space, and its scrollbar sitting on the stills (R7-1, R7-3, R7-4). Entries now share the strip's room while they fit, up to 380 px each. Once they overflow, a whole number fills it exactly, and the strip snaps to entry edges. The shown iteration comes in whole on every fit change, so a restart or a resized pane doesn't leave it cut.

Two behaviour changes came with it:

- The scrollbar gives way to earlier and later arrows in a fixed-width head (`scrollbar-none`).
- A fork link is an entry-sized tile that names its source.

`verify:8` checks the rest at 1440 and 1100, the arrows, End, and a restart at 1100.

The past view says "read-only" once, in the Inspector. Its comments, which belong to the latest, dim with the controls and can't be pressed (R7-8, R7-21). A new variant's mark is an accent ring and the showing one keeps the filled dot, so form tells them apart and a row can carry both (R7-9). The carries-over box in Fork takes `border-strong`, so it keeps its edge in dark (R7-16).

## Amendment: round 8. Entries share the strip by what their lines need

Every entry took one even share, so in round 8's shot 71 "Explain the weighting" sat in room it didn't use while the lines beside it were cut. While the entries fit, an entry whose lines need less than an even share now keeps only that, and the rest share what is left. With room past every need, the narrow ones grow first. Each stays between 180 and 380 px. Once the entries overflow they keep one width, so the arrows step by it and the strip still rests on whole entries. `stripFit` takes each entry's need, measured at max-content, and lays the entries out as grid columns. `verify:8` checks that with room for two entries their lines read whole, and that with a fork beside them no entry holds room a cut line could use. That check fails on the even share.

## Amendment: round 8 fix pass. The head is as wide as its words, and an entry as wide as its lines

Seven reviewers found the strip cutting its lines while room sat idle beside them (R8-7 to R8-11). The head held a fixed 144 px for about 80 px of words, reserving room for arrows that weren't showing. A lone entry grew to 380 px of empty selected fill. At the 180 px floor the newest entry cut "latest" mid-word and lost its age.

- **The head.** It is as wide as its words. The arrows show only while the entries overflow, on the heading's line, which always has their height, so the heading keeps one place either way. The fit judges the room with the head at its words first. Arrows only take room, so entries that overflow without them overflow with them, and the strip never flips between the two.
- **An entry's width.** While the entries fit, each takes what its lines need and no more, between 180 and 380 px, and the rest of the strip stays empty. Short of room they share it as before, but none below its floor. The floor is the entry's number and age, measured, so the age never cuts. "latest" follows the age and wraps out of sight whole when it can't fit, so it reads whole or not at all. The entry's hint names the iteration, its age and what made it.
- **The origin.** The kit's cut never leaves fewer than three characters after a middle dot. "Vary Spin button ×3 · b…" now ends "Vary Spin button ×3…".
- **The skeleton.** Its entry is a first iteration's entry with the words hidden in the bars, so it is as wide as the entry that lands.
- **Edges.** An unselected entry's edge is `border-strong`, about 1.1:1 before. An end with entries hidden past it shows a 12 px shadow over the inset, which at rest holds no entry. The sideways fade stays for an entry passing that edge mid-scroll.

`test/stripFit.test.ts` holds the fit's cases. `verify:8` checks the head's spare width with and without arrows, the heading's place, the entries' edges, the hint's age, no entry wider than its lines, every age whole and "latest" never cut at 1100 and 1440, the edge cues at the end and the middle, and the skeleton against the landed entry. Each of those fails on the round 8 strip.

## Amendment: round 8 fix pass. One grammar for the fork and vary overlays

- **The lineage line says "from", as the stub does.** "Forked from Rota… · iteration 3" cut its parent to a prefix three sibling brainstorms share, and worded the fact differently from the strip's stub (R8-22). The branch glyph already says fork, so the line now reads "from Rota handover · iteration 3". That frees about 45 px for the parent's name. `verify:8` reads the whole line with nothing cut.
- **Fork's popover takes the button's name.** On the latest iteration the button read "Fork" while its popover read "Fork iteration 3" (R8-28). The popover title is now the button's label in both states, and the iteration moves into the description. `verify:8` reads both pairs, and `vocabulary.test` retires the hard-coded title.
- **Popover descriptions read "<context> · <clause>".** Fork wrote a lower-case clause after its "·", while Vary wrote a capitalised sentence, and named its slot twice (R8-27). Fork now reads "Chore roulette · a new brainstorm from iteration 2, with the variant showing in each slot", and Vary "Neon wheel · everything else stays". The footer is now the only line that says where variants land. `verify:8` reads both, and `vocabulary.test` retires the old Vary sentence.
- **Pin comment and Vary element read open while their overlay shows.** Each carried `aria-pressed` for picking only, so once the composer or vary popover opened, the trigger looked like it was at rest (R8-25). Each now sets `aria-expanded` while its overlay shows, which takes the outline button's open recipe, the accent edge on the selected fill. `verify:4` and `verify:8` read the attribute and the accent edge.

## Amendment: round 9 fix pass. The strip pages by need, and its edges read

- **Overflow pages from the newest back.** Once a fork made the strip overflow, every entry took one width, so the latest cut its line while another held 50 px idle (R9-4). `stripFit` now splits the entries into pages from the newest back. Each page shares its room by need, and the oldest page keeps its need. The arrows step a page at a time, and the strip snaps only at page starts. At rest an entry the strip can't show whole is hidden, so the strip never shows half an entry. `test/stripFit.test.ts` holds the paging. At 1440 `verify:8` checks that no entry in view holds spare room while another is cut.
- **A count stays with its noun.** A cut could end "Vary Spin button ×…" (R9-4). The kit's cut now ends before a " ×N" it would split, so the line reads "Vary Spin button…". `test/truncate.test.ts` holds the case.
- **The cue is a shadow toward the strip's surface.** It was entry height, hard at its first column and drawn in `fg` (R9-3). It now runs the strip's full height in `shade`, darkest at the edge and fading to the card within 16 px. `verify:8` samples its pixels in both themes. It checks the edge is at least 8 darker than the card, that it fades back to the card, and that no column is lighter.
- **The fork tile and stub take the entries' edge.** Their dashed edge was the faint `border` (R9-5). It is `border-strong` now. `verify:8` reads every strip element's edge, the skeleton's included, and checks each is `border-strong` and reads at 1.3:1 or more.
- **The skeleton entry is the landed entry's size.** It was 64 px tall against 56, with a 64 by 56 still against 64 by 48 (R9-6). It now shares the still's box and the first line's height. `verify:8` compares the entry and its still within 2 px.
- **The first line reads as home's does.** "Iteration 1  5d · latest" now reads "Iteration 1 · 5d · latest", with the separator home uses (R9-19).
- **A varied variant's key stays off.** The sidebar showed "Spin button A" beside "spin-button-a" (R9-23). A key that only spells its title now stays off, and real keys such as "neon" still show. `verify:8` reads each row's key.
- **Regenerate takes the overlays' grammar and a glyph.** Its description was a sentence beside Fork's and Vary's "<context> · <clause>" (R9-17). It now reads "Chore roulette · a new iteration from the agent", and the button leads with a sparkle glyph, as Fork and Export lead with theirs (R9-24). The glyph is the first thing the header gives up when its breadcrumb runs short, ahead of the request's time, so it never costs the title room. `verify:5` reads both, and `verify:9` holds the fit order. Its blocked hint read "Withdraw request 1 first", though the request can also finish by itself (R9-21). It now states the fact, "Request 1 is still open", and leaves the way out to the bar's Withdraw.
- **Home says "from" too.** The home card's lineage line reads "from <parent> · iteration N", as the session's does.
- **A reveal takes the frame's top edge with its label.** A reveal that hid a frame's label stopped at the label's foot, so the frame's top edge sat 8 px times the zoom under the bar, a doubled rule (R9-27). It now stops at the frame's top edge. `verify:4` sets up that reveal and checks the edge is under the bar or 24 px clear of it.
- **A scrolling frame's gutter takes its block's fill.** The gutter was `muted`, a pale stripe beside a dark block (R9-26). The runtime now paints it with the block root's own background, or the card when the block has none. `verify:2` samples the gutter in both themes.

## Amendment: round 10 fix pass. A page holds what reads whole, and a fork says "from"

- **A page holds only what reads whole.** Pages were packed at the 180 px floor, so at 1100 every line on a page cut and the latest dropped "latest" (R10-2). Pages now pack from the newest back by each entry's need, up to 380 px, and a fork's tile or stub counts at its own floor, since it gives way first. Short of room on a page, the shown iteration takes its need first, then the other iterations, then links. "· latest" sits in the floor, so it never drops. A tile never takes a page alone, where it would grow to an entry's width: it joins the iteration it hangs off. When a page grows to fill the strip, its iterations grow and its links keep their width. `test/stripFit.test.ts` holds each rule. Widths snap down to the 1/64 px grid layout uses, where a measured need already sits, so an entry given its need lays it out exactly. `verify:8` steps every page of a forked and varied brainstorm at 1100 and 1440, and checks that no iteration's line is cut, that the latest names itself in full and that no tile is wider than its words. A tile can cut: at 1100 no page holds the fork's tile whole beside an iteration, and the tile gives way.
- **One wording for a fork's lineage.** The parent's tile read "Fork of iteration 3" (R10-3). It now reads "from iteration 3" under the fork's title, as the card, the row and the stub say it. `vocabulary.test` retires "Fork of".
- **The sidebar's lineage line is one phrase.** "from Rota hando…" sat 10 px off "· iteration 3", which was pinned to the row's end, so the line read as two columns. The line is now one cut text whose tail, "· iteration N", never cuts and follows the cut directly. `verify:8` checks it is one run on one line and that a narrowed line keeps the tail after its ellipsis.
- **The entries' edge is drawn inside them.** The strip clips at its entries' own top and bottom, so the loading entry's outer ring lost its top and bottom edges and read as brackets (R10-8). Every entry's edge, and its focus ring, is now an inset ring. The loading entry's first line also drops the bar where " · " sits (R10-14). `verify:8` checks that no entry, link, stub or loading entry has an edge outside the strip's clip.

## Amendment: Rob's ruling on round 6. The strip waits for a second iteration

With one iteration the open strip was an 84 px band holding one still beside an empty card, and it cut the stage's frame with nothing to compare (R6-62). Rob ruled on 2026-11-07 that the strip starts shut while a brainstorm has one iteration and opens once a second lands.

- **The rule.** `stripOpen` in `src/core/prefs.ts` decides. A brainstorm where Rob has used the toggle keeps what he chose, whatever its iteration count. Otherwise the strip is shut at one iteration and open from two. A fork opens on one iteration, so its strip starts shut too, and its lineage still shows in the breadcrumb and under its thread.
- **One choice per brainstorm.** The toggle used to be one `history.strip` row for every brainstorm. A choice that applies everywhere would open the strip on every new brainstorm once Rob opened it in one, so each brainstorm now keeps its own row, `strip.<session>`. The old row is no longer read. A brainstorm with no row follows the rule above.
- **While the view loads.** The skeleton strip shows only if the strip will. The listing's latest iteration number gives the count before the view arrives, since iterations are numbered from 1 with no gaps.

`test/prefs.test.ts` holds the rule and the stored rows. `verify:8` checks that a brainstorm with one iteration shows no strip and an unpressed toggle, that the strip opens once a second iteration lands, that Rob's shut strip stays shut over a restart, and that a fork opens with its strip shut while its parent's is open.
