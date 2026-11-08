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

## Round 2 (app-systems round-2, library round-7)

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Library list and import | 9.0 | 9.0 | 9.0 |
| Review | 8.5 | 8.0 | 8.6 |
| Browsing | 9.0 | 8.5 | 8.8 |
| Workbench | 9.0 | 9.0 | 8.8 |
| Versions, Theme and Warnings | 8.5 | 8.5 | 8.8 |
| In a brainstorm | 8.5 | 9.0 | 8.8 |
| Agent hand-offs | 8.0 | 8.0 | 8.8 |
| States | 8.5 | 8.5 | 9.0 |
| Self-consistency | 8.0 | 9.0 | 8.8 |
| Fitness for all-day use | 8.5 | 8.0 | 8.6 |
| Completely happy | no | no | no |
| Blockers / majors | 1 / 2 | 1 / 0 | 0 / 2 |
| Sheets won against Storybook | 4 of 4 | 3 of 4 | 4 of 4 |
| Agent hand-offs against Claude Code | Claude Code, narrowly | Claude Code | Brainstorm, narrowly |

**Round 2's blocker, found by all three:** after the agent finished, the review pointed Rob at v2, which was Brainstorm's own tier write rather than the agent's change.

**What round 3 addressed:**
- **Review versions:** Send now records its version, so the callout names the agent's version and what it changed.
- **Repair brief:** repair has its own short brief.
- **Promote row:** it keeps the agent's finish and report line in view.
- **Theme tab:** one column per mode, with a token filter.
- **Header:** the system page's header is compact.
- **Success notices:** Confirm and manual Sync show success in a success tone, not the failure style.

The findings log is `design-review/systems-climb/round-3/findings-log.md`.
