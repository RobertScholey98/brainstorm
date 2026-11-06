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
