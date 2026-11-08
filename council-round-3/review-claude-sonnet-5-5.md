# Round 3 review: design systems in Brainstorm (claude-sonnet-5-5)

I opened all 19 shots, `manifest.json` and ADR 007. I read the source once, to confirm the component count in shot 03.

## 1. Ranking

| # | Shot | Score | Why |
|---|------|-------|-----|
| 1 | 18-upgraded | 9 | Closes the loop. The tag is gone, the strip renders the library's own `WeekStrip`, the theme tweaks survive, and "Now in the kit" says what happened. |
| 2 | 17-upgrade-offered | 9 | Clear blue notice: "Version 2 is out. It adds WeekStrip", and it says the upgrade checks every block first and stays on v1 if one breaks. The green "In v2; upgrade to use it from the kit" on the component row is a good second pointer. |
| 3 | 12-theme-tweaked | 9 | Dark, rose and 1rem radius reach every block at once. The Inspector counts "3 tweaks here", lists the changed token and offers Reset. This is the spec's theme-tweak story shown clearly. |
| 4 | 01-agent-cli | 8.5 | Shows strict mode working. The refusal names every offence (`style_prop`, `raw_element`, `untokened_value`) and the token to write instead. The freeform session refuses `proposed/`. The 72 components here and the 77 in the gallery search box are not reconciled (see Should fix 1). |
| 5 | 04-system-gallery-card | 8.5 | Card renders its real story from the synced kit, with the axes bar above it. Clean. |
| 6 | 08-session-stage | 8.5 | Clear landing state: one block built from the kit, controls first, then the Design system, Not in the system and Theme sections. |
| 7 | 11-inspector-system | 8.5 | The section reads well: system and version, proposed component with Promote, theme controls, then Save/Export/Reset. |
| 8 | 13-theme-save | 8.5 | The popover is prefilled with "Rose night" and says where the theme goes ("any brainstorm that uses it can apply it"). |
| 9 | 19-system-versions | 8.5 | v2 shows `+WeekStrip` and "1 brainstorm: Meal plan". v1 shows "no brainstorm on it". Simple and accurate. |
| 10 | 10-proposed-tag | 8.5 | The "WeekStrip · not in system" tag and dashed outline are legible and don't hide content. The RS avatar clipping is the only distraction. |
| 11 | 09-session-board | 8 | Shows the board with both slots and the tag on the proposed component. The tag sits on the top edge and overlaps the top border of the Sat and Sun pills. The RS avatar is clipped. |
| 12 | 15-promote-started | 8 | "Adding to @robnet/ui in a T3 thread" plus Open thread, and no second Promote. The button stack below it (Save as theme, Apply saved theme…, Export theme) has gone ragged and runs off the bottom. |
| 13 | 16-promote-message | 8 | A complete, actionable brief: which component, where the library is, files, example args, and the sync command to run afterwards. It is long, and the example props appear twice. |
| 14 | 14-theme-export | 8 | Both files are named with a path and "Show in folder". The long paths break across lines at the `Meal plan` space in the file name, so each reads like two items. There is no copy button. |
| 15 | 06-system-theme | 8 | Axes bar, swatches and token values are clear. There is a wide dead gap between name and value, and it only shows tokens for the selected axes. |
| 16 | 03-system-gallery | 8 | A live gallery with a searchable catalog and the axes bar. Three different counts (72, 73, 77) are visible at once. |
| 17 | 02-systems-list | 7.5 | Works, but the card is inset about 33 px from the field and heading above it. Adding a library means typing a path. |
| 18 | 05-system-catalog-search | 7 | Stack leads, as the manifest claims. But the result list includes Breadcrumb, Combobox, Command, NavigationMenu, Progress and Tabs with no visible reason for matching "st". The gallery order doesn't follow the catalog order. |
| 19 | 07-system-warnings | 7 | Honest and complete, but two identical "May not follow the theme" entries, raw Tailwind class names, and no way from a warning to the component. |

## 2. Blockers

None. Every spec point has a screenshot that supports it:

- **Systems and Storybook (decisions 1 to 4):** a React library is synced from a project path, with stories as the import format, and the system is app-wide (shots 01 to 07).
- **Strict mode, one system, freeform stays freeform (decision 5):** shots 01 and 08.
- **Session-owned theme tweaks (decision 6):** shots 12 to 14.
- **Proposed components (decision 7):** the tag, the token errors in shot 01, and Promote in shots 15 and 16.
- **Generated primitives (decision 8):** Stack is marked "Brainstorm's" in shot 05, and the Promote message names them.
- **Upgrade path:** shots 17 to 19.

## 3. Should fix

1. **The component count disagrees.**
   - The tab says "Components 72", the search box says "Search 77 components", the list header says "All stories 73", and the CLI says "72 components · 73 stories". After the upgrade the tab says 73.
   - The 77 is `manifest.catalog.length`, which includes the generated primitives (`src/renderer/Systems.tsx:261`). Nothing on screen says so.
   - Fix: make the placeholder use the same number as the tab, or say "72 + 5 added by Brainstorm" in both places. Have the CLI say the same after `system add`.
2. **Search matches look arbitrary (05).**
   - Breadcrumb, Combobox, Command and NavigationMenu appear for "st", and nothing in the row shows why.
   - Show the matched field, for example "story: …", or restrict matching to names and story titles.
   - The gallery lists Breadcrumb first while the catalog leads with Stack. Order the gallery by the same rank, or say it is alphabetical.
3. **Avatar group initials are clipped (08 to 10, 12, 15, 17, 18).**
   - The RS avatar is half-covered by MK, so it reads "R" with a cut-off letter. It is in every frame, light and dark, and Rob will take it for a rendering bug.
   - If the kit really does this, give the story avatars that fit (a single avatar, or wider spacing). If the overlap is wrong, fix it.
4. **Promote starts a thread with one click (11 to 15).**
   - Promote starts an agent thread in another project, and the message is only visible afterwards (16). Add a short confirm step that names the target project and offers "Preview message".
5. **The theme button row breaks layout after a first save (15, 17, 18).**
   - "Save as theme", "Apply saved theme…" and "Export theme" stack as three uneven left-aligned buttons, and the last is cut off in 15. In 11 and 12 there were two side by side.
   - Use a consistent two-column or full-width arrangement, with a wrap rule.
6. **"Changed here" sits oddly (12, 15, 17, 18).**
   - It appears below the collapsed groups, indented about 12 px more than the controls above it, with no divider. The header counts "3 tweaks here", but the list shows one token.
   - Align it with the controls, and use one wording ("tweaks" or "changed").
7. **The systems page adds libraries by typing a path only (02).**
   - There is no folder picker or project chooser, and the card doesn't show which project the system came from. The ADR keeps `project_id` and decision 4 says "imported and synced from an existing project". The path field is also narrow for real paths.
   - Add a Browse button or a project dropdown, and show the source project on the card.
8. **Warnings need grouping and links (07).**
   - Merge repeated warnings (the two "May not follow the theme" lines into one with both names).
   - Put a full stop after each entry.
   - Replace raw class strings such as `has-[>button]:mr-[-0.3rem]` with component names, or collapse them behind "show details".
   - Make the component names links into the gallery.

## 4. Nits

- **02:** the card sits 33 px inside the content column.
- **05:** the search clear "×" is navy, not the app's teal.
- **03:** "Brand mark" (with a space) sits beside CamelCase names such as "ButtonGroup".
- **09 and 10:** the tag overlaps the top border of the Sat and Sun pills and overshoots the outline by about 7 px on the right. It is readable but not tidy.
- **09:** the strip shows "Mon 10", but 10 Nov 2026 is a Tuesday.
- **11:** Save as theme and Reset are disabled with zero tweaks, but Export theme stays enabled. It is unclear what it would export.
- **13 and 14:** both popovers widen about 160 px over the canvas and cover the controls they came from. A width cap or an anchor to the Inspector would help.
- **14:** the timestamped export names contain spaces ("Meal plan theme-i1-…"), which breaks the path onto two lines. Use a slug.
- **15:** the row says "@robnet/ui" while the spec says "robnet's project", which can mix up library and project. The "Open thread" link disappears in 17 after the sync, with no "Promoted" trace.
- **16:** the example props are given in the prose and again in `component.json`. Drop one.
- **19:** both versions say "synced now", which says nothing. Show a time.
- **06, 07, 19:** the page is mostly empty space under a short list. Fine, but heavy.

## 5. Verdict

**Ship**, 8.3/10. No blockers. The feature is coherent end to end: import, strict composition, proposed components, theming, Promote and upgrade. The fixes are polish and consistency, mainly the count mismatch, the unexplained search results and the clipped avatar.
