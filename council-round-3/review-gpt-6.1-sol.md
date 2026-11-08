# Round 3 review

Reviewed ADR 007 (including its explicit as-built departures), the round 3 manifest, and all 19 PNGs. Scores judge visible evidence; screenshots cannot establish runtime enforcement beyond the terminal examples.

## Ranking

1. **17 — 9.5/10.** Clear pinned-version state, named addition, safe upgrade explanation and an obvious next action; matches the manifest.
2. **18 — 9.5/10.** v2, removal of the proposed tag, Now in the kit, and preserved theme tweaks communicate the completed transition convincingly.
3. **12 — 9/10.** Both blocks and the proposal visibly follow dark, rose and radius changes; the three local tweaks are explicit.
4. **13 — 9/10.** Named theme save explains its app-wide system destination without confusing it with local tweaks.
5. **14 — 9/10.** Export clearly reports both artifacts, readable wrapped paths and a useful folder action.
6. **19 — 9/10.** Version history shows counts, addition and consuming brainstorm, matching the manifest cleanly.
7. **10 — 9/10.** The proposed component boundary and label are unmistakable without hiding day content.
8. **09 — 9/10.** Board, selected variant, kit composition and proposed exception are easy to understand together.
9. **04 — 9/10.** Selected Card and its live story are clear, spacious and consistent with the app.
10. **02 — 8.5/10.** App-wide library, source, sync, version and counts are legible; importing would benefit from a field label.
11. **16 — 8.5/10.** Promotion message carries source, implementation, example props, generated Text caveat and sync instructions; matches the handoff requirement.
12. **01 — 8.5/10.** Concrete rejected and accepted commits demonstrate strict composition and token-aware proposals, plus freeform handling; terminal verbosity is justified.
13. **15 — 8.5/10.** Running promotion replaces Promote with status and Open thread, preventing duplicate submission visibly.
14. **11 — 8.5/10.** System identity, proposal action, theme axes, token groups and export/save actions are present with consistent hierarchy.
15. **08 — 8.5/10.** Initial stage and prop controls are clear; session-wide proposal information is distinguishable through Used by week/strip.
16. **06 — 8/10.** Token values and axes match the manifest, with useful explanation of session-local editing; technical axis labels add friction.
17. **03 — 8/10.** Story gallery is clear and browsable, but 72 in the tab versus 77 in search lacks an explanation of generated primitives.
18. **05 — 8/10.** Stack leads the matches and is marked Brainstorm's; gallery shows matching stories, although its ordering differs from the catalog.
19. **07 — 7.5/10.** Warning categories are honest and legible, but dense prose and an unresolved “4 more” reduce their practical usefulness.

## Blockers

None visible. The static checks and warning-only story/theme failures are explicit accepted as-built departures in ADR 007, so I have not treated them as newly discovered screenshot blockers. The screenshots support the specified main journey; they do not independently prove every enforcement case.

## Should fix

- **03–05:** Explain the component-count difference directly: for example, “72 library + 5 generated”. The Components tab says 72 while search says 77, which currently looks like inconsistent inventory.
- **07:** Provide an expansion or full list for the off-scale warning's “4 more”. Rob needs to inspect all reported values. Separate warning entries into rows with comfortable spacing and a direct gallery/component action where applicable.
- **02:** Give the import path field a persistent label and brief format guidance mentioning Storybook discovery. A sample path alone does not explain what folder qualifies.
- **11–15:** Keep the design-system identity and theme actions easier to reach as Inspector content grows; the screenshot sequence requires substantial independent scrolling to see related state. A collapsible proposal section would help.

## Nits

- **03–06:** Prefer Mode and Accent over data-theme and data-accent, retaining the attribute names as secondary detail.
- **02–07, 19:** Long source paths dominate headers; show the package-relative end prominently and make the full path available on demand.
- **05:** Align gallery ordering with ranked catalog matches where stories exist, or clarify that story order is alphabetical.
- **19:** An exact timestamp on demand would distinguish versions when both currently say synced now.
- **15:** Open thread appears muted despite being the main available action; give it clearer interactive emphasis.

## Verdict

ship — 8.7/10. No visible blockers; the remaining issues concern discoverability and information presentation.
