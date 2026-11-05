# UX method: reduce the work, then design the interface

## Define a task, not a screen collection

A useful study has a recognizable beginning and end: "start work on a task" or "change the account used by this integration." "Redesign Settings" is usually too broad. Follow enough of the surrounding product to understand the task, but keep the deliverable focused.

Consider a newcomer and a returning user where both matter. Explain their differing knowledge without inventing elaborate personas. An expert's workaround is evidence of friction, not proof that the interface works.

Capture these questions in a brief before drawing:

| Question | What the answer changes |
| --- | --- |
| What brought the person here? | Entry point, context already known, urgency. |
| What useful outcome do they want? | Completion boundary and primary action. |
| What do they expect to happen next? | Terminology, action labels and feedback. |
| What must they understand or decide now? | Primary hierarchy and required inputs. |
| What can the product already know? | Inference, defaults and questions to remove. |
| What do they need only occasionally? | Secondary entry points and progressive disclosure. |
| When is the person's attention actually needed? | Interruptions, actionable state and next step. |
| What can fail or remain uncertain? | Recovery, retained work and honest status. |

Observe the existing path where possible. Note unnecessary decisions, repeated data entry, navigation detours, terminology mismatches, ambiguous actions, missing feedback and recovery gaps. Source inspection can establish that two operations are separate; it cannot establish that users understand them. Do not describe a source-only review as observed usability testing.

Record the source of important claims: relevant file/component and inspected version when available, supplied screenshot/reference, live interaction, or user report. Use only evidence actually available. Keep assumptions provisional when inspection is unavailable.

## Make a decision ledger

For each existing item, record: user purpose, when needed, proposed treatment, retained entry point, and behavioral consequence. A short table is enough; omit irrelevant inventory.

| Treatment | Use it when | Required care |
| --- | --- | --- |
| Remove | It serves no necessary user decision, duplicates another input, or exposes internal bookkeeping. | Identify any behavior being retired rather than pretending it still exists. |
| Infer | The current context reliably determines the value. | Handle ambiguity and stale information; don't guess consequential values. |
| Default | One choice is usually appropriate but alternatives matter. | Explain consequential defaults and provide a reachable override. |
| Defer | It matters later or only in an exception. | Give it a discoverable home at the point of need. |
| Ask now | The answer is necessary, not safely knowable, and changes what should happen. | State what the answer controls using the person's language. |

Do not use an Advanced accordion as a substitute for this analysis. Moving ten unnecessary fields out of sight still leaves ten unnecessary fields. Conversely, fewer steps are not automatically better: three brief, clear decisions can be easier than one crowded form.

For defaults, identify the source and precedence. For example, an explicit user override may take precedence over a workflow default, then a project preference, then a product fallback. That ordering is a proposal, not a universal rule. Preserve explicit choices when dependent settings change unless they become invalid; explain the invalidity rather than silently replacing them. Ask only for missing, ambiguous or consequential information.

Tooltips can explain a secondary term or consequence. They cannot rescue an unclear primary label, disclose an essential commitment only on hover, or replace visible help for a required input. Prefer removing the unfamiliar concept when it has no decision value.

## Specify the action contract

Before prototyping, describe the main action in plain language:

- **Input:** what the person is providing and how it will be used.
- **Recipient or target:** which agent, project, account, document or other object receives it.
- **Commitment:** what pressing the action actually causes.
- **Progress and completion:** what the person can observe, and when their goal is fulfilled.
- **Recovery:** what remains saved, what can be retried, and what happens when the result is unknown.

Distinguish selecting from configuring, saving from applying, creating from starting, attaching from delivering, and requesting from approving. The UI may coordinate several operations, but it must not declare completion while the useful outcome has not happened. An uncertain outcome needs a way to inspect or reconcile it; a blind retry can repeat work.

Map relevant states, not every imaginable state. Typical states include empty, ready, editing, validating, working, waiting for the user, completed, failed and outcome unknown. Define the message, available action and retained data for each state that materially affects this task. Show attention only when the person has a useful action, with enough context to perform it.

Necessary capabilities still need a home. For retained uncommon controls, state how a person finds them. Mark proposed behavior changes separately from relocated controls. Keep unsupported capabilities and unavailable integrations honest. Product safety constraints apply even in a simulation; do not present impossible behavior as implemented.

## Design options around different UX hypotheses

Write an option sentence before drawing: "For [this arrival situation], [this interaction] should make [this user decision or outcome] easier because [reason], at the cost of [tradeoff]."

Possible dimensions include:

- **Sequencing:** guided steps, one decision at a time, or a reviewable composition.
- **Decision ownership:** user selects everything, defaults resolve routine choices, or an existing workflow supplies setup.
- **Entry point:** global action, contextual action on the relevant object, or a response to an incoming request.
- **Interaction model:** guided dialog, editable summary, direct manipulation, queue, conversation, or command composition.
- **Time:** configure beforehand, resolve requirements when starting, or interrupt only when a missing value blocks progress.
- **Capability home:** shared account setup, integration detail, project preference, workflow editor, or task-local override.

These are exploration dimensions, not a required list of paradigms for every product. Do not generate a wizard, chat interface and command palette merely to tick boxes. Each alternative must be defensible for the same task and respect accepted constraints.

Use shared fixtures and product components across A–E. Each option should expose its hypothesis, principal compromise and a short task to try. Do not make one option look more convincing by giving it better sample content or omitting its difficult states.

When recommending a combination, describe the resulting single interaction: which part comes from each option, how they connect, and which redundant decisions disappear. "B + D" alone is not a design specification. Treat it as recommended until the user selects it.

## Worked examples from this study method

These examples illustrate reasoning. They are not defaults for every product.

### Starting an agent task

**Weak response:** divide the existing creation form into three pages, rename its title field "What do you want to work on?", then show "Created" while the person still has to open a terminal and type the task again.

**Useful response:** establish whether the field is a name, planning brief or first agent message. If it is a first message sent verbatim to a fresh agent, say so and show its recipient. Infer routine project/workspace values where reliable. The final Start action creates the workspace and launches work using that message. Distinguish creation failure, launch failure and uncertain delivery, retaining the draft and avoiding duplicate starts.

If the user requires transient stepped dialogs, compare five approaches within that constraint: predictable short steps, only missing questions, workflow-led setup, one decision per step, or a message-and-recipient review. A new dedicated creation page is not an acceptable "wild" variant. Workflow-defined defaults are a proposed supporting behavior until implementation evidence establishes them.

### Knowing when help is needed

**Weak response:** give each status a brighter badge and move the same activity feed into cards.

**Useful response:** distinguish ordinary progress from requests that need a person. Present the decision, necessary evidence, available responses and what follows a response. Explore a dedicated inbox and an in-context quick response without treating every event as an interruption. Keep recovery for missed or unresolved requests discoverable.

### Changing an integration

**Weak response:** hide the existing settings collection behind tabs without resolving duplicate names or scattered connection controls.

**Useful response:** identify the configured integration first, then show the relevant account or project setting. Give shared credentials a clear home; explain the scope of a change at the point of commitment. Distinguish draft edits, validation, saving and a change taking effect. Retain edits when validation fails and show how to recover from an expired connection.

## Assess the experience, not the amount of UI produced

Ask whether someone arriving with the task can identify the next useful action, understand its consequences, complete the job without workarounds, and recover without losing their work. Check that returning users can benefit from defaults while newcomers can understand them.

An expert walkthrough can support a design recommendation; it does not prove usability or a percentage reduction in effort. If reporting counts of steps or choices, count a defined path honestly and explain what the count misses. Do not reward coverage, novelty, component count or visual minimalism at the expense of the task.
