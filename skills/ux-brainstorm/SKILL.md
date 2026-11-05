---
name: ux-brainstorm
description: Study one user task with the UX method, then build meaningfully different designs for it as live, switchable blocks in a Brainstorm session that Rob adjusts and pins feedback to. Use when asked for a UX study, alternative task flows, design options to compare, simpler onboarding, setup or settings, or help with an overwhelming interface; when a turn starts with `[brainstorm]`; or when asked to pick up a brainstorm session. Keep narrow visual fixes narrow, and respect requests for discussion or audit only.
---

# UX Brainstorm

Design the shortest understandable path from a person's intent to a useful outcome, then put the competing designs on a Brainstorm canvas. The canvas is the deliverable. Rob switches variants, tweaks props and pins feedback there, and his Regenerate requests come back to this thread as `[brainstorm]` messages.

Pick the branch that matches the turn:

- For a turn that starts with `[brainstorm] session <id> · request <n>`, follow **Handle a request**.
- For "pick up the brainstorm session titled X", follow **Take over a session**.
- For anything else this skill triggered on, follow **Start a study**.

Every branch runs `brainstorm` commands. Read [the Brainstorm loop](references/brainstorm-loop.md) before the first one. It holds the command reference, the working-copy format, how options map onto blocks, and what to do with each error and warning.

## Working contract

- One study covers one coherent user task or decision, not a department of the app.
- Build on the user's accepted choices, corrections and scope. Earlier recommendations the user never accepted are not the baseline.
- Improve the experience before its appearance: remove unnecessary decisions, infer safely, choose understandable defaults, sequence necessary questions, and give occasional controls a home.
- Preserve necessary capabilities and safety boundaries. Name every proposed behavior change and its consequence. Leave permissions, ownership, destructive actions and review gates as they are unless the study is about them.
- A study produces blocks on the canvas, not production changes, a PRD or tickets. Follow an explicit request for a different deliverable. When the user asks to discuss first, stay in discussion until they authorize the study.

## Start a study

1. **Establish the task.** Read [the UX method](references/ux-method.md). Use the conversation before asking, and ask only about choices that materially change the experience. Inspect the product's flow, source, terminology and references from entry point to completion or recovery. A past prototype is not automatically the accepted design. For a broad request, name a short sequence of task studies and start the first.
2. **Write the task brief.** Cover who arrives and why, the desired outcome, what they must understand, unavoidable decisions, known defaults, occasional needs, observable success and relevant failures. Add the decision ledger: each existing input, control and piece of information classified as remove, infer, default, defer or ask now, with why and where any retained capability lives. Label evidence as observed, inferred from source, user-reported or proposed. Never invent research or measured improvements. This brief becomes the session brief.
3. **Choose the hypotheses.** Default to five meaningfully different hypotheses for the task's main decision, or the number the user asked for. Each differs in decisions, sequencing, entry point, interaction model or where the capability lives. If the obvious approach only supports two, use the rest to reconsider the paradigm within the accepted constraints. Say so plainly rather than padding when a full set is indefensible.
4. **Start the session.** Check `T3CODE_THREAD_ID` is set (`$env:T3CODE_THREAD_ID` in PowerShell). If it is empty, tell the user in one line that a Brainstorm session must start inside a T3 thread, and stop. Otherwise run `session new` with the brief on stdin, `pull`, and read the generated `GUIDE.md`.
5. **Build the blocks.** Map the hypotheses onto slots and variants as the loop reference describes. Copy the product's real look from the repo. Each variant implements the task through its useful outcome, including the failure and recovery states that distinguish its hypothesis. [The worked example](references/example/slots/start-dialog/missing-only/) is one valid variant.
6. **Commit until it succeeds.** Run `commit`. Fix every error it lists and commit again until it succeeds, then fix any warning you caused. The commit only proves each block compiles and renders with its defaults, so trace every variant's path to its outcome and through its failure state in the code as well.
7. **Reply in one short line.** Name the session, its slots and variant counts, and the variant you recommend.

## Handle a request

1. Run `brainstorm context <id>`. If it shows no open request, reply in one line that there is nothing to do and stop. If it says this thread is not attached, reply in one line that the session moved to another thread and stop.
2. Run `pull` into a fresh copy. Your earlier copy is stale.
3. Change only the blocks in scope. Address the requested feedback and free text. Keep every `data-part` name an open feedback pin points at, and keep Rob's overridden props valid for his values.
4. Run `commit --addresses <ids>` with only the feedback you actually addressed. Fix errors until it succeeds, and act on each warning as the loop reference says.
5. Reply in one short line naming what changed and any feedback left open.

## Take over a session

1. Run `brainstorm session list`, then `brainstorm session attach "<X>"`. On `ambiguous_title`, show the user the candidates and ask which one. On `wrong_project`, tell the user the session belongs to another project and stop.
2. Run `brainstorm context <id>`. If it shows an open request, handle it as **Handle a request** from step 2. Otherwise reply in one line that this thread now holds the session.

## Boundaries

- Reach Brainstorm only through the `brainstorm` CLI. Its data folder (`%APPDATA%\brainstorm`, or `BRAINSTORM_HOME`) belongs to the app, so leave it unread and unwritten.
- The canvas replaces the old HTML report. Write blocks in the working copy and nothing else. Export is Rob's button.
- In the working copy's `brainstorm.json`, edit only the `slots` list. `format`, `session` and `base` belong to the CLI.
