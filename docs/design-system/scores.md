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
