# Round 3 review: claude-opus-5-5

Judged against the brief's nine decisions and ADR 007, including its "As built" section. I opened every PNG. I read
`src/renderer/Systems.tsx` (catalog search), and robnet's `avatar.tsx` and `avatar.stories.tsx` to check two suspicions.

## 1. Ranking

| # | Shot | Score | Why |
|---|------|------:|-----|
| 1 | 18-upgraded | 9 | The upgrade is visibly complete: v2 badge, tag gone, theme tweaks kept, and "Now in the kit" says what changed. |
| 2 | 01-agent-cli | 9 | Every refusal names the rule and the token to write instead, and the freeform refusal proves decision 5. |
| 3 | 16-promote-message | 8.5 | Complete and actionable: folder, entry, "kit" mapped to the entry, generated Text called out, story args, sync step. |
| 4 | 15-promote-started | 8 | Promote turns into a clear running state with Open thread and no second Promote. |
| 5 | 17-upgrade-offered | 8 | The callout says what v2 adds, that blocks are checked, and that the session stays on v1 on failure. |
| 6 | 19-system-versions | 8 | Plain and correct: counts, `+WeekStrip`, which brainstorm builds on which version. |
| 7 | 12-theme-tweaked | 8 | Dark, rose and 1rem reach every block, including the proposed WeekStrip; "3 tweaks here" and "Changed here" are clear. |
| 8 | 04-system-gallery-card | 8 | One component, one live story, and the catalog selection is obvious. |
| 9 | 14-theme-export | 8 | Both files with full paths, Show in folder, and a sentence saying what each file is for. |
| 10 | 09-session-board | 7.5 | Both slots composed from the kit with the proposed part tagged, but the avatar initials are clipped (see Blockers). |
| 11 | 10-proposed-tag | 7.5 | The tag and dashed outline read well, but the tag sits on the Sat/Sun pills' top edge, and the clipped avatar is front and centre. |
| 12 | 11-inspector-system | 7.5 | Everything the manifest lists is there, but Save as theme is disabled with no reason given and Export is enabled with nothing to export. |
| 13 | 13-theme-save | 7.5 | A clear popover with a sentence on scope, but it covers the Accent value and the token rows it is saving. |
| 14 | 06-system-theme | 7.5 | Axes and tokens are legible with swatches, but the value column leaves half the row empty, and the axis names differ from the Inspector's. |
| 15 | 03-system-gallery | 7 | Live stories under switchable axes work, but the tab says "Components 72" and the search box says "Search 77 components". |
| 16 | 08-session-stage | 7 | Kit-only block and the Design system section both show, but the WeekStrip card sits under a block that doesn't use it, with no hint of where it is used. |
| 17 | 02-systems-list | 7 | It works, but the card is indented from the add field above it, and the placeholder path reads like a filled-in value. |
| 18 | 07-system-warnings | 7 | Honest warnings, but "and 4 more" can't be expanded, nothing links to the gallery, and "the kit writes…" starts lower case after a bold label. |
| 19 | 05-system-catalog-search | 6 | Stack leads as claimed, but six of the twelve rows (Breadcrumb, Combobox, Command, NavigationMenu, Progress, Tabs) don't contain "st", and nothing says they matched on a part's name. Stack has no story, so the featured result is missing from the gallery, which also orders differently from the list. |

## 2. Blockers

- **09, 10, 11, 12, 13, 14, 15, 17, 18: the AvatarGroup clips its own initials ("RS" loses its S under "MK").** This looks
  broken in every session shot. It also looks like a fidelity bug rather than the kit's real behaviour. robnet's
  `Avatar` is `size-8` (32px) with `text-sm` initials, and `AvatarGroup` overlaps by `-space-x-2` (8px). At those
  values, two letters clear the overlap. In the shots the avatars are larger and overlap more than 8px. One of
  `size-8`, `-space-x-2` or `text-sm` probably resolves differently on the canvas (word scan, `@layer kit` order, or a
  token). The light-mode ring from `*:data-[slot=avatar]:ring-background` is also hard to see. That is the drift
  decision 7 exists to stop: the design looks different from the real app. **Fix:** render the kit's own Avatar
  `Group` story in the gallery and compare it with the block. If the gallery also clips, trace the class that resolves
  wrong in the sync's compiled CSS. If the gallery is right, look for what the canvas frame changes. If the kit really
  renders this way, add a sync warning for it, and change the study's content so the hero shots don't show a broken
  component.

## 3. Should fix

- **05: explain or tighten part matches.** Either show the matched part in the row ("Breadcrumb · BreadcrumbList") or
  drop part matches when name matches exist. Make the gallery follow the list's ranking: today Questionnaire ranks
  above Breadcrumb in the list but comes after Progress in the gallery.
- **05: give the generated primitives a story.** Stack is "Brainstorm's" with no count and no gallery example, so
  Rob can't see the primitive he is told was generated for him (decision 8). A generated Stack, Grid and Text story
  from the tokens would also show the gap scale.
- **03, 04, 05: one component count.** The tab says 72 and the search box says 77 (catalog plus the five generated
  primitives). Use one count, or label the second one ("77, including 5 added by Brainstorm").
- **15 and 18: the theme footer's buttons stack at three widths.** In 11 and 12, Save as theme and Export theme sit
  side by side. After a theme is saved, Save as theme, Apply saved theme… and Export theme each take their own row,
  each a different width. Keep them on one row, or make them a uniform full-width stack.
- **18: the library's WeekStrip doesn't look like the proposed one.** Day names were muted in v1 (12) and are
  full-contrast in v2 (18). The library is the source of truth, so this is correct behaviour. But the round trip is
  meant to show "keep its look", and Rob isn't told the look changed. Either make the capture's library WeekStrip
  match the proposal, or have Upgrade note which blocks render differently.
- **11: explain the disabled and empty states.** Save as theme is greyed out without saying "no tweaks yet". Export
  theme is enabled with zero tweaks. Disable Export too, or have it say there is nothing to export.
- **06 vs 08–18: one name for the theme axes.** The system page says `data-theme`/`data-accent` and the Inspector says
  Mode/Accent. Show the same label in both places, with the attribute as secondary text on one of them.
- **07: make the warnings actionable.** Expand "and 4 more" in place, and link ContextMenu, Spinner and the no-story
  components to their gallery entries ("check it in the gallery under each theme" names a place but gives no way to
  get there).

## 4. Nits

- 03–07, 19: the version badge sits about 6px above the Sync button's centre line.
- 02: the system card is inset about 32px from the path field and the page heading's left edge.
- 10: the "not in system" tag covers the top border of the Sat and Sun pills. It fades on hover, but it could sit
  just above the outline.
- 17: "Promote one to add it to the library" still shows when the only proposed component is already in v2.
- 18: "week/strip uses the kit's component now" starts a sentence in lower case.
- 16: the story args appear twice (inline in the bullet and again as `component.json`). One copy is enough.
- 09: the recipe slot tags Lemon pancakes "Breakfast" and offers "Add to Tuesday" in a dinner plan. Study content only.
- 01: the off-scale warning is a long single line, so in the terminal the class list runs on. Listing one value per
  line would scan better.

## 5. Verdict

**not yet: 7.5/10.** The flow meets the spec end to end (import, strict checks, proposed components with token rules,
session theme, Promote, upgrade), and most shots are clear. The AvatarGroup rendering differently from the kit's own
source undercuts the feature's core promise in every session shot, so it needs checking before ship. The catalog
search's unexplained matches are the next worst.
