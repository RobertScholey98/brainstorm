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
