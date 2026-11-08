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

## Round 3 (app-systems round-3, library round-8)

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Library list and import | 9.5 | 9.5 | 9.4 |
| Review | 9.0 | 9.0 | 9.2 |
| Browsing | 9.0 | 8.5 | 9.2 |
| Workbench | 9.0 | 9.0 | 9.0 |
| Versions, Theme and Warnings | 9.5 | 9.5 | 9.2 |
| In a brainstorm | 9.0 | 9.5 | 9.3 |
| Agent hand-offs | 9.5 | 9.5 | 9.4 |
| States | 9.0 | 9.5 | 9.4 |
| Self-consistency | 9.0 | 9.0 | 9.2 |
| Fitness for all-day use | 9.0 | 8.5 | 9.1 |
| Completely happy | no | no | no |
| Blockers / majors | 0 / 1 | 0 / 0 | 0 / 0 |
| Sheets won against Storybook | 4 of 4 | 3 of 4 | 4 of 4 |
| Agent hand-offs against Claude Code | Brainstorm, narrowly | Brainstorm | Brainstorm |

**Round 3's major, found by Opus:** after a new version landed, the gallery kept the old kit and silently dropped the agent's new story.

**What round 4 addressed:**
- **Gallery reload:** the gallery reloads the kit when a new version lands, and a story the loaded kit lacks gets a frame that says so.
- **Agent's changes in the review:** a component the agent changed counts as unseen again, its row says "changed in vN", and Show takes the walk to it. Once the agent has answered, what Rob sent folds to one line.
- **Props:** the sync reads each component's props from the library's source, with defaults, required flags and choices.
- **Generated primitives:** they render an example.
- **Single-story components:** they open in the workbench, as Storybook does.
- **Upgrade errors:** they read in Rob's words, without the duplicate symptom, and expand in full.
- **Header path:** it shows the folder, with the full path one click away.
- **Proposed tag:** it is neutral, so amber means warning only.

The findings log is `design-review/systems-climb/round-4/findings-log.md`.

## Round 4 (app-systems round-4, library round-9)

| Area | Claude Opus 5.5 | GPT-6.1 Sol | Claude Sonnet 5.5 |
| --- | --- | --- | --- |
| Library list and import | 9.5 | 9.5 | 9.5 |
| Review | 9.5 | 9.0 | 9.4 |
| Browsing | 9.5 | 9.5 | 9.4 |
| Workbench | 9.5 | 9.0 | 9.4 |
| Versions, Theme and Warnings | 9.5 | 9.5 | 9.3 |
| In a brainstorm | 9.5 | 9.5 | 9.4 |
| Agent hand-offs | 9.5 | 9.5 | 9.5 |
| States | 9.5 | 9.5 | 9.4 |
| Self-consistency | 9.5 | 9.5 | 9.4 |
| Fitness for all-day use | 9.5 | 9.0 | 9.3 |
| Completely happy | no | no | no |
| Blockers / majors | 0 / 0 | 0 / 0 | 0 / 0 |
| Sheets won against Storybook | 4 of 4 | 4 of 4 | 4 of 4 |
| Agent hand-offs against Claude Code | Brainstorm | Brainstorm | Brainstorm |

No blockers or majors. Opus scored 9.5 in every area. What kept the others below it: review chrome pushing the walk down, Usage below a long Props list, Card's Usage being a bare `<Card />`, and a stale "with the agent" note.

**What round 5 addressed:**
- **Review callout:** its actions sit beside the message. Once the agent has synced, the version line and what Rob sent share one line, and a note it answered reads "answered in v3". A story it added reads "new in v3".
- **Upgrade breaks:** the callout leads with its cause.
- **Versions:** they say what a change came through: "MealCard (renders Button)".
- **Usage:** it sits above Props and shows a render story's own JSX. Prop choices are chips.
- **Gallery bar:** a many-valued axis is a picker, so the bar is one row.
- **Times and paths:** times in the same minute show seconds, and the library card shows the short path.

The findings log is `design-review/systems-climb/round-5/findings-log.md`.
