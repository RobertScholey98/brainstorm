# Design climb scores

The bar: every area 9.5 or higher from every member, completely happy, no blocker or major, and Brainstorm ahead of each exemplar on every comparison sheet. The reviews are in `design-review/round-<n>/` (gitignored), and the captures come from `npm run capture` and `npm run capture:sheets`.

## Round 1 (baseline captures, round-0)

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 7.0 | 8.0 | 7.0 |
| Navigation and lists | 6.5 | 6.0 | 6.0 |
| Canvas chrome | 6.0 | 6.0 | 6.0 |
| Inspector and controls | 6.5 | 7.0 | 7.0 |
| Overlays | 6.0 | 6.0 | 6.5 |
| Feedback | 7.0 | 6.5 | 6.5 |
| States and request phases | 6.0 | 6.0 | 6.0 |
| Dark mode | 6.5 | 7.0 | 6.5 |
| Self-consistency | 5.5 | 7.0 | 6.0 |
| Fitness for all-day use | 6.0 | 6.5 | 6.5 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit | 0 / 7 / 15 / 6 | 0 / 4 / 6 / 2 | 0 / 5 / 17 / 2 |
| Comparison sheets won | 0 of 4 | 0 of 4 | 0 of 4 |

**Coverage gaps:**
- Image reads hit a request limit for Sonnet (8 of the 1100 shots seen) and for Opus (6 of the light 1440 shots seen).
- From round 2, each member gets a smaller set of shots per read pass, so coverage is complete.

## Round 2 (captures round-2, after the foundation, kit, shell and screens phases)

Claude members reviewed two slices, light and dark. Their scores here take the lower of the two slices for each area.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 8.5 | 9.3 | 8.5 |
| Navigation and lists | 8.5 | 9.0 | 8.0 |
| Canvas chrome | 7.5 | 8.0 | 8.0 |
| Inspector and controls | 8.5 | 8.8 | 8.0 |
| Overlays | 8.5 | 9.2 | 8.0 |
| Feedback | 8.5 | 8.7 | 8.0 |
| States and request phases | 8.5 | 9.3 | 8.5 |
| Dark mode | 8.5 | 9.1 | 8.5 |
| Self-consistency | 8.0 | 9.0 | 8.5 |
| Fitness for all-day use | 8.5 | 8.5 | 8.5 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit (light + dark) | 0 / 5 / 25 / 12 | 0 / 1 / 3 / 3 | 0 / 1 / 24 / 18 |
| Comparison sheets won | 1 of 4 (vs-t3-session) | 0 of 4 | light slice 3 of 4, dark slice 0 of 2 |

**Coverage.** GPT Sol saw all 216 shots. The Claude members lost reads to a per-request media limit after about 50 to 58 images:

| Member | Light slice | Dark slice |
| --- | --- | --- |
| Opus | most | 58 of 108 |
| Sonnet | most | 49 of 108 |

From round 3, each Claude member reviews four slices (theme × width) and writes notes per shot as it reads.

## Round 3 (captures round-3, after the round 2 fixes, the stage view, X2 to X6 and the frameless header)

Each Claude member reviewed four slices:
- **A:** light 1440, shots 01 to 40, plus the sheets
- **B:** dark 1440, shots 01 to 40, plus the T3 sheets
- **C:** 1440 shots 41 to 65, both themes
- **D:** 22 key 1100 shots, both themes

No read failed. Each score below is the member's lowest across its slices.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 8.5 | 9.5 | 7.5 |
| Navigation and lists | 8.5 | 9.4 | 7.5 |
| Canvas chrome | 7.5 | 9.5 | 8.0 |
| Inspector and controls | 8.5 | 9.5 | 8.0 |
| Overlays | 8.0 | 9.0 | 8.0 |
| Feedback | 7.5 | 9.0 | 8.0 |
| States and request phases | 8.0 | 9.2 | 7.5 |
| Dark mode | 8.5 | 9.5 | 8.7 |
| Self-consistency | 7.5 | 9.2 | 7.5 |
| Fitness for all-day use | 8.0 | 9.3 | 8.0 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit (all slices) | 0 / 1 / 52 / 46 | 0 / 0 / 4 / 0 | 0 / 2 / 37 / 38 |
| Comparison sheets won | 2 of 4 (both sessions) | 3 of 4 (lost vs-claude-home) | A: 0 of 4; B: 2 of 2; C: 4 of 4 |

The majors are:
- **Opus B:** a blank canvas, and a sidebar skeleton in the home shape, while a brainstorm loads.
- **Sonnet A:** in light the main card is darker than the sidebar, so it reads as recessed.
- **Sonnet A:** home rows are 48 px and repeat their meta, and home has no page heading.

The light 1440 slice scored lowest for both Claude members.

## Round 4 (captures round-4, after two round 3 fix passes)

Same slices as round 3. No read failed. Each score below is the member's lowest across its slices.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 8.5 | 9.5 | 8.0 |
| Navigation and lists | 8.5 | 9.5 | 8.0 |
| Canvas chrome | 8.0 | 8.9 | 8.0 |
| Inspector and controls | 8.5 | 9.6 | 8.0 |
| Overlays | 8.5 | 9.5 | 8.0 |
| Feedback | 8.5 | 9.3 | 8.0 |
| States and request phases | 8.0 | 9.6 | 8.0 |
| Dark mode | 9.0 | 9.5 | 8.0 |
| Self-consistency | 8.5 | 9.4 | 8.0 |
| Fitness for all-day use | 8.5 | 9.3 | 8.0 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit (all slices) | 0 / 1 / 27 / 45 | 0 / 0 / 1 / 1 | 0 / 0 / 16 / 32 |
| Comparison sheets won | 2 of 4 (both sessions; lost both homes) | 3 of 4 (lost vs-claude-home) | 4 of 4 named, none ahead in every area |

The major is from Opus D. Canvas pins shrink with their frame's zoom, so on the 64% board at 1100 they render at about 13 px.

Every Claude slice found the blocked-Regenerate hint covering Open thread and Withdraw. The home sheets lose or tie on navigation and lists. The exemplars' homes show previews, live status and search, and Brainstorm's overview repeats the sidebar as text cards.

## Round 5 (captures round-5, after the round 4 fix pass and the home pass: previews, search, filters, settle, no variant notes)

Each Claude member reviewed five slices:
- **A:** light 1440, shots 01 to 40, plus the sheets
- **B:** dark 1440, shots 01 to 40, plus the T3 sheets
- **C:** light 1440, shots 41 to 70
- **E:** dark 1440, shots 41 to 70
- **D:** 22 key 1100 shots, both themes

No read failed. Each score is the member's lowest across its slices. GPT Sol's review was still running when the workflow change (round 6) superseded these captures.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 8.5 | pending | 8.0 |
| Navigation and lists | 8.5 | pending | 7.0 |
| Canvas chrome | 8.5 | pending | 8.0 |
| Inspector and controls | 8.5 | pending | 8.0 |
| Overlays | 8.5 | pending | 7.5 |
| Feedback | 8.5 | pending | 8.0 |
| States and request phases | 8.5 | pending | 8.0 |
| Dark mode | 8.8 | pending | 8.0 |
| Self-consistency | 8.0 | pending | 7.0 |
| Fitness for all-day use | 8.5 | pending | 8.0 |
| Completely happy | no | pending | no |
| Blocker / major / minor / nit (all slices) | 0 / 1 / 35 / 60 | pending | 0 / 1 / 31 / 58 |
| Comparison sheets won | 4 of 4 named; both T3 sheets in every area; Claude ahead on self-consistency on vs-claude-home | pending | 3 of 4 named; Claude took vs-claude-session on shell chrome |

The two majors:
- **Opus D:** a board frame shows a horizontal scrollbar, which breaks ADR 002.
- **Sonnet D:** home previews leave a blank band under short and wide frames.

Opus's best slices (A and B, 1440 shots 01 to 40) reached 9.0 to 9.4. The low scores come from the new home surfaces in slices C and E.

These findings are open:
- a toolbar jump when counts load
- project counts that ignore the status filter
- a settle hint over the search field
- the header hint reading as a button (T26)

The vs-claude-session sheet pairs Claude's home with a Brainstorm session, because no Claude session exemplar exists.

## Round 6 (captures round-6, after the history, fork and vary build, ADR 005)

The slices match round 5, extended to shot 80:
- **A:** light 1440, shots 01 to 40, plus the sheets
- **B:** dark 1440, shots 01 to 40, plus the T3 sheets
- **C:** light 1440, shots 41 to 80
- **E:** dark 1440, shots 41 to 80
- **D:** 22 key 1100 shots, both themes

GPT Sol reviewed all 312 shots and the four sheets. No read failed. Each Claude score is the member's lowest across its slices.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 8.5 | 9.0 | 7.0 |
| Navigation and lists | 8.0 | 9.0 | 7.0 |
| Canvas chrome | 8.0 | 9.5 | 7.0 |
| Inspector and controls | 8.5 | 9.0 | 8.0 |
| Overlays | 9.0 | 9.5 | 7.5 |
| Feedback | 9.0 | 9.5 | 8.0 |
| States and request phases | 8.0 | 9.3 | 7.0 |
| Dark mode | 8.5 | 9.3 | 8.0 |
| Self-consistency | 8.0 | 9.2 | 7.0 |
| Fitness for all-day use | 8.0 | 9.1 | 7.0 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit (all slices) | 0 / 2 / 34 / 56 | 0 / 0 / 3 / 1 | 0 / 6 / 36 / 39 |
| Comparison sheets won | 4 of 4 named. Slice A ahead in every area on all four. Slice B has T3 ahead on navigation on vs-t3-session-dark | 4 of 4 named, not ahead in every shared area | 2 of 4 named in slice A (Claude took vs-claude-session on chrome, vs-t3-home-dark a tie leaning T3). Slice B won both T3 sheets |

Opus slice A was the first slice to put Brainstorm ahead in every area on all four sheets.

All eight majors come from the header at 1440. In the asking and previous-thread phases the title shrinks to "Chore …" or "C.". The breadcrumb on a new fork drops below R5-31's 160 px floor. The compact header switches on at a fixed 60rem pane width, so at 1440 the title is the only thing that gives way, and at 1100 labels drop even with 150 to 215 px free. Sonnet E's other two majors are the history strip's hard cut at its edge and the fork breadcrumb.

These findings recur across members:
- the strip has no fade and is too tall for one iteration
- wide frames show as slivers in strip stills
- "Queued in T3" shows in two tones, header and sidebar
- the history toggle reads pressed with no strip
- the loading view has no strip
- an accent sliver shows through the Inspector's top fade (R5-21)
- vary rows lose the letter that tells them apart at 1100
- the Regenerate attached row shows a raw part id (R5-47)
- vertical dividers sit off centre (the kit separator's `self-stretch`)
- a Windows toast covers shot 56 (T23)

## Round 7 (captures round-7, after the two round 6 fix passes: the measured header fit, the 84 px strip, one phase table, `Truncate`, `BlockedHint`, `Count`)

The slices match round 6. Shot 56 was refused because the screen was locked, so each slice that held it has one image fewer. GPT Sol reviewed all 308 shots and the four sheets. No read failed. Each Claude score is the member's lowest across its slices.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 8.5 | 9.5 | 8.0 |
| Navigation and lists | 7.5 | 9.0 | 8.0 |
| Canvas chrome | 7.0 | 9.5 | 7.0 |
| Inspector and controls | 8.0 | 9.0 | 8.0 |
| Overlays | 8.5 | 9.5 | 8.0 |
| Feedback | 8.0 | 9.5 | 8.0 |
| States and request phases | 8.5 | 9.5 | 8.0 |
| Dark mode | 8.5 | 9.5 | 9.0 |
| Self-consistency | 7.5 | 9.0 | 8.0 |
| Fitness for all-day use | 8.0 | 9.0 | 8.0 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit (all slices) | 0 / 1 / 28 / 23 | 0 / 0 / 2 / 0 | 0 / 1 / 14 / 34 |
| Comparison sheets won | 4 of 4, ahead in every area (slice A); both T3 sheets in every area but a states tie (slice B) | 4 of 4 named | 3 of 4 in slice A (T3 took vs-t3-session-dark narrowly); slice B named Brainstorm on both T3 sheets with T3 ahead on navigation on the session sheet |

Five of the ten Claude slices scored 9.0 or higher in every area: Opus A, B and D, and Sonnet A and B. The minimums come from the 1440 shots 41 to 80, Opus E (7.0 to 8.5) and Sonnet C (7.0 to 8.0).

The two majors:
- **Opus E:** the history strip cuts entries at its edges. The still on screen is cut mid-word after a restart (64), a fork link shows as a bare icon (78), and fragments sit at the edge (79, 80). With three iterations it rests about 10 px scrolled, so the left fade never clears.
- **Sonnet D:** at 1100 a fork row with a live request shows "Try a ca…", because the row's status and branch mark don't shrink and its title has no floor.

These findings recur across members:
- the Inspector's top fade still shows a slider thumb or a cut control (R6-9)
- home's top fade leaves half-cut titles in 69 (R6-57)
- the strip's lines use bare `truncate`, not `Truncate` (`History.tsx:195`)
- the frame label is cut by the canvas bar after a pin, pick or vary reveal
- the past view leaves feedback Edit and Delete live
- a new variant's dot differs from "showing" only by colour

## Round 8 (captures round-8, after the round 7 fix pass and the fade removal: opaque pane heads, the strip that lands on whole cards, the sidebar title floor)

The slices match round 7. Shot 56 was refused again because the screen was locked. GPT Sol reviewed all 308 shots and the four sheets. No read failed. Each Claude score is the member's lowest across its slices.

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Shell | 9.2 | 9.5 | 8.0 |
| Navigation and lists | 8.9 | 9.5 | 8.0 |
| Canvas chrome | 9.1 | 9.3 | 8.0 |
| Inspector and controls | 9.5 | 9.6 | 8.0 |
| Overlays | 9.1 | 9.0 | 8.0 |
| Feedback | 9.6 | 9.6 | 8.0 |
| States and request phases | 9.4 | 9.6 | 8.0 |
| Dark mode | 9.4 | 9.5 | 7.0 |
| Self-consistency | 9.2 | 9.3 | 8.0 |
| Fitness for all-day use | 9.1 | 9.4 | 8.0 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit (all slices) | 0 / 0 / 14 / 20 | 0 / 0 / 1 / 2 | 0 / 0 / 14 / 11 |
| Comparison sheets won | 4 of 4 named. Slice A has Claude ahead on shell on vs-claude-home (the new head band). Slice B ahead in every area on both T3 sheets | 4 of 4 named | 3 of 4 in slice A (T3 took vs-t3-home-dark on its two-line rows). Slice B gave vs-t3-session-dark to T3 by a hair, on dark surface layering |

No member raised a major. Every Opus slice scored 8.9 or higher in every area, and Opus D reached 9.2 to 9.6. GPT reached 9.5 or higher in six areas. Sonnet scores in whole points and gave 8 to 9 in four slices and 7 to 8 in slice B.

These findings recur across members:
- the pane head paints `bg-card` over a `canvas` body (`scroll-pane.tsx:40`), so home shows a head band with no rule (five reviewers)
- the strip's head column holds 144 to 160 px for about 80 px of text, so entries cut their lines and "latest" loses its age (seven reviewers)
- the settle hint covers home's search field, a regression of R5-4 (four reviewers)
- the Regenerate hint wraps to two lines (four reviewers)
- a live fork row still cuts its title at 1440
- Export drops its label in shot 35 with about 54 px free
- in dark the sidebar-to-card step is thin against T3 (Sonnet, two slices; disputed as V45)
