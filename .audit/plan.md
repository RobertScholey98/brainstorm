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

## Phase A framing

**Done predicate.** All seven "done when" checks in the brief pass on the real artifact. Items 1 to 6 are proven by committed scripts (`npm run verify:*`) against a real Electron app with an isolated `BRAINSTORM_HOME`. Item 5's T3 leg and item 7 are proven by a real T3 round trip from a fresh thread, recorded in the trail.

**Scope.** Greenfield. Roughly 7 units, est. 4–8k lines including tests. Blockers found in grounding: none. Electron 44.10.2 + node:sqlite + Playwright verified in a spike.

**Rigor: high.** The working-copy format and the SQLite schema are one-way doors, because every stored iteration and the rewritten skill depend on them. Hence the arena on the design. Everything else is reversible and gets a scripted check per unit, not extra review.
