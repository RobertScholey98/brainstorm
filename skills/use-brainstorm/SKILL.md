---
name: use-brainstorm
description: Study one user task with the UX method, then build meaningfully different designs for it as live, switchable blocks in a Brainstorm session that Rob adjusts and pins feedback to. Use when asked for a UX study, alternative task flows, design options to compare, simpler onboarding, setup or settings, or help with an overwhelming interface; when a turn starts with `[brainstorm]`; when asked to pick up a brainstorm session; or when asked to show, set or clear the design system this project's brainstorms use. Keep narrow visual fixes narrow, and respect requests for discussion or audit only.
---

# Use Brainstorm

Design the shortest understandable path from a person's intent to a useful outcome, then put the competing designs on a Brainstorm canvas. The canvas is the deliverable. Rob switches variants, tweaks props and pins feedback there, and his Regenerate requests come back to this thread as `[brainstorm]` messages.

Pick the branch that matches the turn:

- For a turn that starts with `[brainstorm] promote <Name> from session <id>`, follow **Promote a component**.
- For a turn that starts with `[brainstorm] import the design system from <root>`, `[brainstorm] repair the <name> design system (<id>)` or `[brainstorm] review of the <name> design system (<id>)`, follow **Import a design system**.
- For a turn that starts with `[brainstorm] session <id> · request 1 · fork of <parent> iteration <n>`, follow **Start a fork**.
- For any other turn that starts with `[brainstorm] session <id> · request <n>`, follow **Handle a request**.
- For "pick up the brainstorm session titled X", follow **Take over a session**.
- For a question about which design system this project's brainstorms use, run `brainstorm project show`. To set it, run `brainstorm project use <system>`, or `brainstorm project use none` to clear it. Reply with the line the command prints, and start no study.
- For anything else this skill triggered on, follow **Start a study**.

Every branch runs `brainstorm` commands. Read [the Brainstorm loop](references/brainstorm-loop.md) before the first one. It holds the command reference, the working-copy format, how options map onto blocks, and what to do with each error and warning.

## Working contract

- One study covers one coherent user task or decision, not a department of the app.
- Build on the user's accepted choices, corrections and scope. Earlier designs the user never accepted are not the baseline.
- Improve the experience before its appearance: remove unnecessary decisions, infer safely, choose understandable defaults, sequence necessary questions, and give occasional controls a home.
- Preserve necessary capabilities and safety boundaries. Name every proposed behavior change and its consequence. Leave permissions, ownership, destructive actions and review gates as they are unless the study is about them.
- Every branch except **Import a design system** ends with a one-line reply: that line is the whole message, and the detail lives on the canvas and in the session brief.
- A study produces blocks on the canvas, not production changes, a PRD or tickets. Follow an explicit request for a different deliverable. When the user asks to discuss first, stay in discussion until they authorize the study.

## Start a study

1. **Establish the task.** Read [the UX method](references/ux-method.md). Use the conversation before asking, and ask only about choices that materially change the experience. Inspect the product's flow, source, terminology and references from entry point to completion or recovery. A past prototype is not automatically the accepted design. For a broad request, name a short sequence of task studies and start the first.
2. **Write the task brief.** Cover who arrives and why, the desired outcome, what they must understand, unavoidable decisions, known defaults, occasional needs, observable success and relevant failures. Add the decision ledger: each existing input, control and piece of information classified as remove, infer, default, defer or ask now, with why and where any retained capability lives. Label evidence as observed, inferred from source, user-reported or proposed. Never invent research or measured improvements. This brief becomes the session brief.
3. **Choose the hypotheses.** Default to five meaningfully different hypotheses for the task's main decision, or the number the user asked for. Each differs in decisions, sequencing, entry point, interaction model or where the capability lives. If the obvious approach only supports two, use the rest to reconsider the paradigm within the accepted constraints. Say so plainly rather than padding when a full set is indefensible. The hypotheses shape the designs. Never write them up for Rob: he judges the variants on the canvas himself, so no variant carries a note, a rationale or a ranking.
4. **Start the session.** Check `T3CODE_THREAD_ID` is set (`$env:T3CODE_THREAD_ID` in PowerShell, `$T3CODE_THREAD_ID` in a POSIX shell). If it is empty, tell the user in one line that a Brainstorm session must start inside a T3 thread, and stop. `session new` builds with the project's design system on its own, in every worktree, so don't choose one yourself. Only when the user names a system, run `brainstorm project show`: if the project has none, run `brainstorm project use <system>` so later brainstorms use it too; if it has another, pass `--system <system>` to this `session new` only. Pass `--system none` only when the user asks for a design without the system. Run `session new` with the brief on stdin. If it says Rob hasn't confirmed the system, tell the user in one line to confirm it on Brainstorm's Design systems page, and stop. Its output names the system the session builds with; the loop reference's **Design systems** says how that changes the blocks. Then `pull`, and read the generated `GUIDE.md`.
5. **Build the blocks.** Map the hypotheses onto slots and variants as the loop reference describes. With a design system, compose its kit as `system/CATALOG.md` lists it; otherwise copy the product's real look from the repo. Each variant implements the task through its useful outcome, including the failure and recovery states that distinguish its hypothesis. [The worked example](references/example/slots/start-dialog/missing-only/) is one valid variant.
6. **Commit until it succeeds.** Run `commit`. Fix every error it lists and commit again until it succeeds, then fix any warning you caused. The commit only proves each block compiles and renders with its defaults, so trace every variant's path to its outcome and through its failure state in the code as well.
7. **Reply in one line.** Name the session, its slots and their variant counts, and the design system it builds with, or that it has none, as `session new` printed it. The whole reply looks like `Session s_x "Pin a comment": 1 slot, 3 variants, built with acme-ui v7.` or `Session s_x "Pin a comment": 1 slot, 3 variants, no design system.`

## Handle a request

1. Run `brainstorm context <id>`. If it shows no open request, reply in one line that there is nothing to do and stop. If it says this thread is not attached, reply in one line that the session moved to another thread and stop.
2. Run `pull` into a fresh copy. Your earlier copy is stale.
3. Change only the blocks in scope. Address the requested feedback and free text. Keep every `data-part` name an open feedback pin points at, and keep Rob's overridden props valid for his values. A `vary` scope asks for new variants of one element; build them as the loop reference's **Vary** says.
4. Run `commit --addresses <ids>` with only the feedback you actually addressed. Fix errors until it succeeds, and act on each warning as the loop reference says.
5. Reply in one line naming what changed and any feedback left open. The whole reply looks like `Request 2: changed pin-flow/pick-and-widen; addressed #1, #3 still open.`

## Start a fork

Rob forked one iteration of a brainstorm to try something new from it, and the app started this thread for the fork.

1. If the message names `BRAINSTORM_HOME`, set it on every `brainstorm` command as it says. T3 started this thread with its own environment.
2. Run `brainstorm session attach <id>` with the fork's session id from the message. The fork waits for this thread, so attach takes it.
3. Run `brainstorm context <id>`. Its `fork of` line names the parent and the iteration. The fork's iteration 1 is that iteration narrowed to the variant Rob picked in each slot, with his settings baked in as the props' defaults (one `baked default` line each) and his open pins carried over. That is the accepted baseline: build from it, not from the parent's other variants.
4. Handle request 1 as **Handle a request** from step 2. Its free text is what Rob asked the fork to try, and its scope is everything, so add variants or slots when that asks for them. Keep the baked defaults unless the instruction is about them.
5. Reply in one line naming the fork, its parent and what changed. The whole reply looks like `Fork s_y of s_x: added 3 calmer wheels; #1 still open.`

## Promote a component

Rob promoted a component a brainstorm proposed, so the design system's library gains it. This thread runs in the library's own project.

1. Read the message. It names the component, the brainstorm it came from, the library's folder and entry, and holds the proposed files.
2. Add the component to the library the way the library writes its components: its file layout, styling approach, variants and tokens. Keep the proposed look. Export it from the entry, and write a story with the example args the message gives.
3. Run the library's own checks (typecheck, tests, Storybook build) as its project does.
4. Run `brainstorm system sync <system>` with the id the message names, so the design system's next version has the component.
5. Reply in one line naming the component and the new version. The whole reply looks like `Promoted ChoreList into @acme/ui; synced v4.`

## Import a design system

Rob pointed Brainstorm at an app project, so its own components can be a design system. This thread runs in that project. The message is the brief: it says what to decide, the adapter and stories to write, and the check that decides when they are right.

1. Read the project's components, its stylesheet and its tsconfig `paths` before writing anything.
2. Write `.brainstorm/system.json` and the missing stories as the message says. Change none of the project's own components. Leave out a component that can't pass, and say why in the report.
3. Run `brainstorm system check <root>` until every gate passes, then the `system add` or `system sync` the message names.
4. This branch ends with the short report the message asks for, not one line: the components under each tier, the ones left out and why, any stubs, and any warning left.

Rob reviews every newly added system before brainstorms can use it. A review message carries his notes and the tier moves Brainstorm already wrote into the adapter's `tiers`. Keep those moves, act on each note the same way, and report what you changed for each.

## Take over a session

1. Run `brainstorm session list`, then `brainstorm session attach "<X>"`. On `ambiguous_title`, show the user the candidates and ask which one. On `wrong_project`, tell the user the session belongs to another project and stop.
2. Run `brainstorm context <id>`. If it shows an open request, handle it as **Handle a request** from step 2. Otherwise reply in one line that this thread now holds the session. The whole reply looks like `This thread now holds session s_x "Pin a comment"; no request is open.`

## Boundaries

- Reach Brainstorm only through the `brainstorm` CLI. Its data folder (`BRAINSTORM_HOME` if set, else `%APPDATA%\brainstorm` on Windows, `~/Library/Application Support/brainstorm` on macOS or `~/.config/brainstorm` on Linux) belongs to the app, so leave it unread and unwritten.
- The canvas replaces the old HTML report. Write blocks in the working copy and nothing else. Export is Rob's button.
- In the working copy's `brainstorm.json`, edit only the `slots` list. `format`, `session` and `base` belong to the CLI.
