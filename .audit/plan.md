# Brainstorm v0.1 run plan

The task list for this run (no TodoWrite tool in this session), kept in the order it runs.

## figure-it-out phases

- [x] Read the poteto-mode Principles section
- [x] Phase A. Frame: done predicate, scope, rigor (below)
- [ ] Phase B. Design the workflow: architect arena on the v0.1 contract, then the unit list below
- [ ] Phase C. Run the loop: one unit at a time, each ends in a scripted check on the real artifact
- [ ] Phase D. Decision trail in `.audit/brainstorm-v0.1.tsv`, a row per decision as it lands
- [ ] Phase E. Verify the whole against the predicate, then Finishing a round

## Feature playbook steps (inside Phase C)

1. `how` over the affected subsystem. skip: greenfield repo; the T3 CLI, json-render and the current skill were grounded by hand (scratchpad grounding.md)
2. `architect` for parallel design exploration
3. Throughput checkpoint (below)
4. Delegate code-writing to opus `poteto-agent` owners with named data shapes and success criteria
5. Verify on the matching surface (Playwright `_electron` for the app, the real `brainstorm` CLI from a T3 thread for the API)
6. Small ordered commits
7. `interrogate` if the design is contested
8. Finishing a round

## Throughput checkpoint

- **Blocking first steps.** U1 (scaffold, pure core and check worker) and then U2 (store, service, HTTP, bridge, CLI). Every later unit builds on these types and this API.
- **Independent workstreams.** After U2, U3–U5 (renderer, feedback and regenerate, export) are one code-coupled stream in `src/renderer` and `src/canvas`. U6 (the skill rewrite in `skills/ux-brainstorm/`) touches disjoint files and runs in parallel in its own worktree.
- **Shared mutable state.** The git index and `package.json`. The renderer stream owns `package.json` while it runs. The skill worker adds no dependencies and works in its own worktree, merged by me.
- **Smallest safe decomposition.** One opus owner per unit, run in sequence, because each unit's types are the next unit's input. Fanning out inside a unit would split one data model across agents.

## Units

| Unit | Scope | Check |
|---|---|---|
| U1 | scaffold, `src/core` types, props, controls, workingCopy, machines, check worker | `npm test` green with literal-value tests; render probe rejects a throwing block |
| U2 | store, Brainstorm service, HTTP, bridge, CLI, fake T3, headless server | `npm run verify:1` (item 1, hermetic), then a live run from this T3 thread |
| U3 | Electron shell, renderer, canvas runtime, variant switch, controls panel, overrides | `verify:2`, `verify:3` through Playwright `_electron` |
| U4 | feedback pins and status, regenerate, request phases, tracker | `verify:4`, `verify:5` (fake T3 states) plus a live T3 round trip |
| U5 | export | `verify:6` (file:// in Chromium, server stopped, zero console errors) |
| U6 | rewrite `/ux-brainstorm` in-repo plus an install script | `verify:7`: a fresh T3 thread runs it end to end and a second thread takes over by title |

## Phase A framing

**Done predicate.** All seven "done when" checks in the brief pass on the real artifact. Items 1 to 6 are proven by committed scripts (`npm run verify:*`) against a real Electron app with an isolated `BRAINSTORM_HOME`. Item 5's T3 leg and item 7 are proven by a real T3 round trip from a fresh thread, recorded in the trail.

**Scope.** Greenfield. Roughly 7 units, est. 4–8k lines including tests. Blockers found in grounding: none. Electron 44.10.2 + node:sqlite + Playwright verified in a spike.

**Rigor: high.** The working-copy format and the SQLite schema are one-way doors, because every stored iteration and the rewritten skill depend on them. Hence the arena on the design. Everything else is reversible and gets a scripted check per unit, not extra review.
