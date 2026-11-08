# ADR 008: Design systems from app projects

Status: accepted. It extends ADR 007. Rob asked for it on 2026-11-08, after trying to add `src/renderer/components` from
Brainstorm's own repo: "I thought I'd be able to point it at a components folder in an application", then "point it at
the root of a project and have an agent install a design system from an existing project", with "a version hash … so
that it can auto update when it detects that the component system within a project has changed." Rob settled the
questions below in the same conversation.

## Context

ADR 007 syncs a design system from a library's package folder. Sync needs a `package.json`, an entry module that
exports every component, a stylesheet, and Storybook stories. A component folder inside an app has none of these: no
package of its own, no index file, imports through tsconfig aliases such as `@/lib/utils`, and usually no stories.
Some of its components also read app state. A copy of those components in Brainstorm would drift from the app on the
first change, which is the failure ADR 007 exists to stop.

## Decision

### An adapter in the project says where the system is

A project describes its system in `.brainstorm/system.json`, committed with the project. Sync reads it and builds from
the project's own files, every time, with no agent involved.

```jsonc
{
  "name": "brainstorm-ui",
  "primitives": ["src/renderer/components/ui/*.tsx"],
  "composites": [],
  "layouts": [],
  "exclude": ["src/renderer/components/ui/sidebar.tsx"],
  "shared": ["src/renderer/lib/utils.ts"],
  "stylesheet": "src/renderer/styles.css",
  "aliases": { "@/": "src/renderer/" },
  "stories": [".brainstorm/stories/**/*.stories.tsx"],
  "frame": null,
  "stubs": {}
}
```

- Paths are relative to the project root, the folder that holds `.brainstorm/`.
- **The kit is the files in the tier globs**, minus `exclude`. Brainstorm generates the entry module from them. A
  library with its own entry can name it with `"entry"` instead, and its tier globs then only label its exports.
- **`shared`** lists the app files the kit may import that aren't components, such as a `cn()` helper.
- **`aliases`** maps import prefixes to folders, as the app's tsconfig `paths` do.
- `frame` and `stubs` are ADR 007's.
- A package folder with no adapter syncs as ADR 007 describes. An adapter wins when both exist.

The adapter lives in the project, not in Brainstorm, so Rob reviews it in a diff, it survives a reinstall, and anyone
who moves a component sees the file that names it. Later it could also sync to a server as a premium feature. The
content-addressed versions make that a matter of uploading what the server hasn't seen.

### An agent writes the adapter, and a check decides when it's done

Brainstorm can't tell from a folder which components are the design system and which are app features, or what a
component needs to render. An agent can, so importing a system is an agent's job. It runs in a T3 thread on the
project, the same way Promote does (ADR 007). Its output is fixed: the adapter, plus a story for every component that
has none, under `.brainstorm/stories/`.

`brainstorm system check <project root>` decides when the agent is done. It syncs without saving and fails when:

| Gate | Fails when |
|---|---|
| Builds | The kit bundle or its CSS doesn't compile |
| Inside its boundary | A kit file imports a project file that isn't in a tier glob, `shared`, a story or a stub. It names both files. |
| Every component shown | A component the kit exports has no story, or its story throws or renders nothing |
| Themeable | The CSS has no colour tokens |

The agent loops until the check passes, then runs `brainstorm system add <project root>`. It ends with a report of what
it included, what it excluded and why.

The boundary gate is what makes "which files are the system" checkable. A component that reads a store, fetches data or
uses the router pulls app files into the bundle. The agent must then exclude it, or stub what it reads, and the report
says which it chose.

**On the Design systems page,** a folder that doesn't sync offers **Import with an agent** beside the error. This starts
the thread on the T3 project that holds the folder, and the page shows the import as in progress, with a link to the
thread, until `system add` succeeds for that folder.

### Tiers: primitive, composite, layout

Every component in a system has a tier, and the tier decides what it may contain:

| Tier | Example | What it may contain |
|---|---|---|
| Primitive | Button, Badge, Input | Anything the library writes. A proposed primitive may write HTML, with the kit's tokens and scales (ADR 007). |
| Composite | MealCard, WeekStrip | Kit components only. A proposed composite follows the block rules: no HTML, `className`, `style` or CSS. |
| Layout | App shell, sidebar with content | Kit components arranged around slots (`children` or named props). A proposed layout follows the composite rules. |

- **A component's tier** comes from its story's Storybook `tags` (`"primitive"`, `"composite"`, `"layout"`), then from
  the adapter's tier globs, else it is a primitive. Brainstorm's generated `Stack`, `Grid`, `Box`, `Text` and `Heading`
  are primitives.
- **Composites must be presentational.** A composite takes props and renders. The boundary gate holds the app's
  composites to this, since a composite that reads app state pulls in app files.
- **A proposed component declares its tier** in `component.json` (`"tier": "composite"`). A new or changed proposed
  component without one is refused (`missing_tier`). One committed before tiers existed counts as a primitive.
- **Promote** names the tier, and the folder the adapter gives that tier, so the thread puts the component where its
  peers are.
- **The agent's catalog leads with layouts and composites.** It says: use a layout or composite when one fits,
  otherwise compose primitives, and propose a component only when neither works.

### Fingerprints, auto-sync and change lists

A version has three hashes, each for a different question:

1. **Inputs fingerprint: has anything changed?** A hash of the size and modified time of every file the build read.
   That covers what esbuild bundled, the stylesheets Tailwind loaded, the files Tailwind scanned for classes, the
   adapter, and the list of files matching the story and tier globs, so a new file counts. Recomputing it is a pass of
   `stat` calls, cheap enough to run every few seconds.
2. **Version hash: is this a new version?** ADR 007's hash of the bundle and CSS. A change that doesn't alter the build,
   such as an edited comment, makes no new version.
3. **Item hashes: what changed?** One hash per story's rendered HTML, plus the token values already in the manifest.
   The Versions tab lists changed components ("Button: 2 stories render differently") and changed tokens
   (`--radius` 0.5rem → 0.625rem), as well as the components added and removed.

**Auto-sync.** While Brainstorm runs, it checks every system's fingerprint every five seconds, and syncs any system
whose fingerprint changed. A sync that fails is shown on the system ("Didn't sync: …"), with **Repair with an agent**
for a project with an adapter. It isn't retried until the fingerprint changes again.

**Upgrades stay Rob's.** A new version never moves a session. Brainstorm checks each session's latest iteration
against the new version in the background, and the upgrade offer says either "Nothing breaks" or names the blocks
that would fail the check.

### The component workbench

The Components tab grows from a gallery into a workbench, like Storybook's:

- **One story at a time.** Clicking a story's title opens it alone, at a chosen width: fill, 1280, 768 or 390 pixels.
- **Controls.** The story's args can be edited live. Text, number, switch and choice controls come from the arg values
  and the story's `argTypes`. Changes last until Rob leaves the story.
- **Props.** A table of the component's props, from its stories' args and `argTypes`. Brainstorm ships no TypeScript
  compiler, so props no story names aren't listed. Every component has a story once an agent has imported the system.
- **Usage.** The JSX for the story as it's set, ready to copy.
- **Grouped by tier.** The component list has Layouts, Composites and Primitives sections.

The workbench and the agent's catalog read the same manifest, so a prop the table shows is a prop the agent sees.

## Data

Store migration 8 (`src/core/store.ts`):

```
design_system         + inputs_json (the files and globs the last sync read), sync_error
system_import         root -> project_id, thread_id, link, state, error, at
```

The manifest gains `tier` on catalog entries, and `tags`, `argTypes` and `htmlHash` on stories. Versions synced before
this ADR lack them, and read as primitives with no item hashes.

## Alternatives not taken

- **The agent copies or rewrites the components into Brainstorm.** A copy is a fork. It can't update itself, and it
  drifts.
- **Brainstorm guesses the system from the folder.** It can't tell a design-system component from an app feature, or
  stub what a component needs to render, so the guess is wrong in exactly the cases that matter.
- **Stories and the adapter kept inside Brainstorm.** The project stays untouched, but Rob can't review them in a diff,
  and they're lost on reinstall.
- **Watching the file system for changes.** Recursive `fs.watch` differs by OS and misses changes on some network
  drives. Polling `stat` on a few thousand files every five seconds costs milliseconds.
- **A props table from TypeScript.** It needs the TypeScript compiler in the app, for props an agent-imported system
  already shows through its stories.

## As built

- `test/systemsFromProjects.test.ts` runs the whole flow on `test/app-fixture`, a small shadcn-style app:
  - adding its components folder fails with `no_system`;
  - the import brief;
  - a check that fails the boundary and stories gates, then passes;
  - `system add` from the adapter;
  - auto-sync with a change list;
  - a failed sync that isn't retried until the project changes, and its repair brief;
  - tiers in a session.
- `scripts/capture/app-systems.mjs` drives the built app through the same flow for screenshots. It covers:
  - the import callout and card;
  - the tier-grouped catalog and the workbench;
  - the version diff;
  - the upgrade check, both clean and breaking;
  - the failed sync with Repair.
- A library synced from its package, as in ADR 007, declares no tiers, so all its components list as primitives.
  A story's `tags: ["composite"]` or `tags: ["layout"]` sets a component's tier. Composites and layouts are
  promoted the same way.
- The upgrade check runs once per session iteration and system version, in the background, and the Inspector
  disables Upgrade while it says the upgrade breaks something.
- The workbench lists props from the stories' `args` and `argTypes` only, as decided. A prop that no story sets
  doesn't appear, and the panel says so.
