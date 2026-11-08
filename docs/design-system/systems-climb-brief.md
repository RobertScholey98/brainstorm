# Design climb brief: design systems in Brainstorm

Rob asked on 2026-11-08 to hill-climb the design systems UI against Claude Code and Storybook. This brief follows the shell climb's (`shell-brief.md`) and covers only what ADR 007 and ADR 008 added.

## Goal

Rob reviews and browses design systems in Brainstorm, and hands work on them to agents. Browsing a library should be at least as good as Storybook, which is the tool for it today. Handing a review to an agent, and seeing what the agent is doing, should be at least as good as Claude Code's own hand-offs. Seen side by side, Brainstorm must beat both on every measure below.

## Exemplars

- **Storybook.** Storybook 10's manager UI, built from robnet's own `packages/ui` stories, the same library Brainstorm syncs in the library capture. `scripts/capture/storybook.mjs` captures it into `design-review/exemplars/storybook/`, and `scripts/capture/systems-sheets.mjs` puts each shot beside Brainstorm's.
- **Claude Code.** There's no capture of it. Reviewers judge against what they know of Claude Code's patterns for a human reviewing an agent's work and sending it back:
  - plan approval, with feedback that keeps the agent planning;
  - permission prompts;
  - review comments sent to the agent;
  - the status of background work and where to open it.

## Measures

Reviewers score each area out of 10:

1. **Library list and import.** The Design systems page, the add field, system cards, the import offer and the running import.
2. **Review.** The review callout, the component walk, the tier switch, raising and dropping issues, Send and Confirm, and what each says afterwards.
3. **Browsing.** The catalog and its tier sections, search, the gallery and the theme axes. Compared with Storybook's sidebar and canvas.
4. **Workbench.** One story with widths, controls, props and usage. Compared with Storybook's canvas and Controls panel.
5. **Versions, Theme and Warnings tabs.**
6. **In a brainstorm.** The Inspector's design system section, proposed-component tags, theme tweaks, save and export, Promote, and the upgrade check.
7. **Agent hand-offs.** The messages Brainstorm sends agents (import, review, repair, promote), the agent's terminal output, and what Rob sees while an agent works. Compared with Claude Code.
8. **States.** No system, importing, awaiting review, sent, syncing, a failed sync, and repair.
9. **Self-consistency.** With each other and with the rest of Brainstorm: one meaning per colour, one style per component, one scale per property.
10. **Fitness for all-day use.** Density, hierarchy, keyboard reach and calm.

For each comparison sheet, reviewers also score Brainstorm and Storybook on the areas the sheet shows, and name the better of the pair. For area 7 they say whether Brainstorm's hand-off beats Claude Code's.

## The bar

A round passes when all of these hold:

- Every council member scores every area **9.5 or higher**.
- Every member says they are completely happy.
- No member lists a blocker or a major.
- Every member scores Brainstorm above Storybook on every sheet and above Claude Code on agent hand-offs.

## Scope

- **In.** The Design systems page and every state of it, the system's tabs, the review, and a brainstorm's design system UI. Light theme at 1440×900, from `scripts/capture/app-systems.mjs` and `scripts/capture/systems.mjs`.
- **Out.**
  - Dark mode and the smallest window. The shell climb covers both, and the captures here don't take them yet.
  - The content of agent-written blocks and of the library's own stories.
  - Storybook features Brainstorm doesn't aim at: addons, interaction tests and MDX docs.

## Behaviour changes allowed

Change behaviour only where the UX falls short of an exemplar's pattern, and log each change in the findings log before it lands. Keyboard reach in the review walk and the catalog is pre-approved. Anything else that changes behaviour goes to Rob first.

## Constraints

The shell brief's constraints hold: its stack, the design lint, the kit components, and captures that rerun unchanged each round.

## Rounds

- Each round lives in `design-review/systems-climb/round-<n>/` (gitignored), with `app/`, `library/` and `sheets/`.
- The council is Claude Opus 5.5, GPT-6.1 Sol and Claude Sonnet 5.5, at high reasoning and read-only.
- Scores are committed in `docs/design-system/systems-scores.md`.
