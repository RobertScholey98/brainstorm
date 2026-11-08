# Design systems climb scores

The bar is in `systems-climb-brief.md`:

- every area 9.5 or higher from every member;
- every member completely happy;
- no blocker or major;
- Brainstorm ahead of Storybook on every comparison sheet, and ahead of Claude Code on agent hand-offs.

The reviews are in `design-review/systems-climb/round-<n>/`, which is gitignored. Three scripts make the captures:

- `scripts/capture/app-systems.mjs`
- `scripts/capture/systems.mjs`
- `scripts/capture/systems-sheets.mjs`

## Round 1 (app-systems round-1, library round-6)

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Library list and import | 8.0 | 8.5 | 8.5 |
| Review | 7.5 | 7.0 | 8.0 |
| Browsing | 8.0 | 7.5 | 8.5 |
| Workbench | 8.0 | 8.5 | 8.3 |
| Versions, Theme and Warnings | 7.5 | 7.5 | 8.0 |
| In a brainstorm | 8.5 | 8.5 | 8.5 |
| Agent hand-offs | 6.0 | 6.0 | 7.0 |
| States | 7.0 | 6.5 | 7.8 |
| Self-consistency | 7.0 | 8.5 | 8.3 |
| Fitness for all-day use | 7.5 | 7.5 | 8.2 |
| Completely happy | no | no | no |
| Blocker / major / minor / nit | 1 / 4 / 14 / 0 | 2 / 5 / 5 / 0 | 1 / 6 / 10 / 2 |
| Sheets won against Storybook | 0 of 4 | 3 of 4 | 0 of 4 (1 tie) |
| Agent hand-offs against Claude Code | Claude Code | Claude Code | Claude Code |

**What round 2 addressed:**
- **Repair message (all three blockers):** the capture read the import thread. The product's repair brief was right.
- **Live agent status:** sent review notes stay visible, and the import, review and Promote rows show the agent's live status.
- **Upgrade breaks:** Rob gets the errors and a way forward.
- **Story rows and props:** the catalog lists each component's stories, and Props merges every story's args.
- **Search:** matches are ranked and marked.
- **Smaller fixes:** failed-sync times, Confirm's blocked reason, and keyboard reach.

The findings log is `design-review/systems-climb/round-2/findings-log.md`.
