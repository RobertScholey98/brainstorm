# ADR 007: Design systems

Status: accepted and built. Rob asked for it on 2026-11-08: "create designs that exclusively use the design systems already in place", so a design "can simply be built from existing components". Rob settled the questions below in the same conversation. **As built** at the end records where the build departs from this design and why.

## Context

A block can import only `react` (`ALLOWED_IMPORTS` in `src/core/check/rules.ts`). To match a product, the skill tells the agent to copy the product's token values into `block.css` (`skills/use-brainstorm/references/brainstorm-loop.md`). Nothing ties a design to the product's real components, so designs drift. Rob described the failure: a design "looking good in isolation, but looking slightly off when I build it in the real application and some container component has marginally different padding, flex behaviour or corner radii."

The brief left this open as "Design context" (`docs/brief.md`): "Should a session be able to load a project's design tokens or components so blocks match the product?" This ADR answers it.

A design system here is a React component library. Usually it is a custom library inside one of Rob's projects, such as Brainstorm's own `src/renderer/components/ui`. A library from npm is the same case, with its entry in a project's `node_modules`. Only React libraries are in scope.

## Decision

### A system is a synced copy of a library in a project

- **App-wide.** Systems are stored app-wide, not per project, so a library from one project can serve brainstorms on any project.
- **Source.** A system remembers its source: a project path, the library's entry file, and the glob of its Storybook stories. It can also name provider stubs (router, query client, i18n) that the library's components need to render, and a **frame component** (see below).
- **Sync.** Sync rebuilds the system from its source into a new **system version**. It runs from a button on the system's page, from `brainstorm system sync`, or from an optional file watcher. A version is immutable and addressed by content hash, as blocks are.
- **Stories are the import format.** Each story's args give a component's props in Brainstorm's props schema, and the stories become the examples on the system's page and in what `brainstorm context` lists. A component with no story still imports, with a warning.
- **Tokens.** A system version holds its tokens (colour, spacing, radius, type, border, shadow), read from the library's CSS custom properties or a DTCG token file.

### Sync builds in the app

The app ships sucrase, which compiles one file at a time. A library needs bundling: following imports into the repo's `node_modules` and generating its Tailwind CSS. The app will ship esbuild and the Tailwind compiler for each OS, so sync needs no agent turn. React is external to the bundle, so the library runs on the canvas's React 19.

### Checks on every sync

A version is saved only when:

- every component compiles;
- every story renders offline in the sandbox with the declared stubs;
- every component visibly changes when the theme changes. A component that ignores the tokens fails, naming the component. Tailwind v4 resolves theme values through CSS variables, so a v4 library passes. Tailwind v3 writes the values into its classes unless the config points them at variables, so a v3 library may fail for spacing and radius even when its colours pass.

A sync also **measures the kit**. It renders every story and records the computed values the library uses for spacing, radius, font size, weight and line height, border width, shadow and colour. Values that fall off the token scale are reported as warnings ("Card pads 13 px; the spacing scale has 12 and 16").

### A session uses one system version, or none

- A session without a system stays freeform, as today.
- A session with a system uses exactly one system version. A later sync doesn't change the session. The canvas offers to upgrade it, and the upgrade re-checks every block as a commit does.
- When a session has a system, blocks import from `"kit"`. The canvas runtime resolves `"kit"` to the session's system version, as it resolves `"react"`. `pull` writes the kit's types and catalog into the working copy, and `GUIDE.md` lists the components with their props and stories.

### Blocks compose; they never write HTML

In a session with a system, the commit check refuses a block that has:

- a lowercase JSX tag;
- a `style` or `className` prop;
- a `block.css` file;
- an import other than `react` and `kit`;
- a `createElement` call with a tag name.

The check reads the compiled JSX. The risk is an agent drifting, not one working around the rules, so a syntax check is enough.

This is the default and the only mode for a session with a system. A "kit-first" mode that only warned was considered and dropped, because proposed components give a design an honest way past a missing component.

### Primitives come from the system, or Brainstorm generates them

Blocks that can't write HTML need layout and text primitives: `Box`, `Stack`, `Grid`, `Text` and `Heading`, with props on the token scales (`gap="md"`, not `gap={13}`). When the library has none, sync generates them from the system's tokens and marks them "added by Brainstorm". They are on the scale by construction, and Rob can copy them into the repo. A library that has its own primitives keeps them.

### The frame component

Drift often comes from the container a design sits in, not the design itself. A system can name the component the real app wraps a page or panel in, such as a page shell. The canvas renders each block inside it, so a block's outer padding, width and flex context match the real app.

### Proposed components fill the gaps

When the kit has nothing that fits, the agent writes a **proposed component** in the working copy's `proposed/<Name>/`, with a story. The canvas labels it "not in system" wherever it appears.

- **It may use raw HTML**, unlike a block. A proposed component is a candidate for the library, written the way the library's own components are.
- **It must conform to the kit.** The commit check renders its story and refuses any computed value outside the system's tokens and the values the kit was measured using: spacing, radius, type, border, shadow and colour. The error names the element and the value ("proposed/ChoreList [row]: border-radius 7px; the kit uses 4, 6, 8").
- **Promote.** Promote sends the component to a new T3 thread on the system's source project (`t3 thread start`), which adds it to the library. The next sync makes it a system component, and sessions that upgrade use the real one.

The value check can't judge layout intent. A proposed component can use `justify-content: space-between` where the kit would use a `Stack` with a gap, and both are valid CSS. Blocks can't make that mistake, because they compose; in a proposed component, the "not in system" label and the promote review are where it is caught.

### Themes

- A system version's tokens become CSS custom properties on the canvas frame's root, so a change reaches every block at once.
- A system can have several themes (light, dark, brand). The canvas bar switches between them as it switches variants.
- **Theme tweaks belong to the session.** The theme panel derives controls from the token types: Colour for colours, Slider for spacing and radius steps, Select for fonts. A tweak is saved as a session token override, as block prop overrides are saved now.
- **Save as theme** writes the session's tweaks into the system as a new theme. **Export theme** gives the changed tokens as DTCG JSON and CSS, to apply in the repo.

## Data

Store migration 7 (`src/core/store.ts`):

```
design_system          id, name, source_json (root, entry, css, stories, stubs, frame), project_id
design_system_version  system_id, n, hash, bundle, css, manifest_json (catalog, stories, styles), warnings_json, synced_at
design_system_theme    system_id, name, state_json (axes, tokens)
session                + system_id, system_n (null for a freeform session; set at creation, changed only by upgrade)
session_theme          session_id, key ("axis:<attribute>" or "token:<name>") -> value
proposed_content       hash -> source, css, json, compiled
iteration_proposed     session_id, n, name -> hash
promotion              session_id, name -> state, thread_id, link, error, at
```

Proposed components are content-addressed files of an iteration, alongside its blocks, so history, fork and vary carry them without new rules.

## Alternatives not taken

- **Tokens only.** Consistent colours and spacing, but every input and dropdown is still drawn by the agent, which is the drift this ADR exists to stop.
- **Agent-written ports of the components.** Needed only for non-React libraries, which are out of scope. A port is a copy, and copies drift.
- **The agent builds the bundle.** It needs no compilers in the app, but every sync becomes an agent turn, and a sync button that waits on a thread isn't a sync button.
- **Several systems per session.** Mixing two systems' primitives makes "everything composes" unenforceable.
- **Theme tweaks saved straight to the system.** Every experiment would change the system for every session using it. Save as theme makes that explicit.

## Build order

1. Tokens, themes and the theme panel, for a system with tokens only. Useful at once and runs no library code.
2. Sync and `import from "kit"`, with Brainstorm's own `components/ui` as the first library.
3. The block check, the generated primitives and the frame component.
4. Proposed components, the measured-value check and Promote.

The riskiest unknown is step 2: whether a real library renders offline in the sandbox with its providers stubbed. Prototype it against one of Rob's libraries before building the rest.

## As built

Built on 2026-11-08 and checked end to end against robnet's `packages/ui` (72 components, 73 stories) with
`scripts/capture/systems.mjs`. Where the build departs from the decision above:

- **No per-OS binaries.** Sync bundles with esbuild-wasm and compiles Tailwind v4 with its pure-JS compiler, so the app
  ships no native tools. Tailwind's scanner is replaced by a word scan of the library's sources; it keeps words with
  parentheses and commas, such as `py-(--card-spacing)`, which shadcn's v4 components write.
- **Checks are static, and story failures warn.** A story that throws in the sandbox is a warning (`story_failed`), not
  a refused version, because one broken story shouldn't hold back a library's other 72 components. "Every component
  changes with the theme" is a static check of the CSS each story's classes reach (`theme_ignored`), and the measured
  values come from the kit's compiled CSS rather than from rendered computed styles. The compiled CSS holds every value
  the kit's classes can produce, and reading it needs no browser in the sync.
- **Proposed components are checked statically.** The commit check allows a proposed component's `className` only
  classes the kit's CSS or its own `component.css` defines, and checks every value in `component.css` against the kit's
  tokens and measured scales. The error names the value and the nearest one the kit uses ("padding: 9px is off the kit's
  spacing scale; use 8px, the nearest the kit uses"). Where the kit has tokens for a family, a value on the scale must
  still be written through them (`untokened_value`): `calc(var(--spacing) * 2)`, `var(--radius)`, `var(--text-sm)`,
  so a theme that changes the token changes the proposed component too. A 1px hairline is exempt. `component.css` is
  served wrapped in `@scope ([data-proposed]) `.
- **Theme controls live in the Inspector.** The session's theme has axes (attributes such as `data-theme` and
  `data-accent` that the library's CSS switches on) and token overrides. The Inspector's Design system section holds both;
  the canvas bar stays about slots and variants. An axis with up to three values is a segmented control and one with more
  is a select. Tokens are text fields with a colour swatch, folded into Colours and Sizes and type lists that keep any
  token this session changed in view, since a library's 40-odd tokens would otherwise bury the rest of the Inspector.
- **The kit's CSS sits under the app's.** The canvas loads the kit's CSS inside `@layer kit`, so its preflight and
  utilities can't restyle the frames, pins and labels the canvas draws around blocks. The theme is set on the canvas
  document's root as attributes, classes and custom properties.
- **The "not in system" tag** is drawn with CSS anchor positioning on the proposed component's root element, since the
  component's wrapper is `display: contents` and has no box to hang it on. It sits on the element's top-right edge and
  fades while the pointer is over the component, so it never hides the content it labels.
- **A new version reaches open sessions.** A sync that creates a version notifies every session on the system, so an open
  Inspector offers the upgrade at once, naming the components the version adds and removes; the Versions tab lists the
  same changes per version. The changes are the library's component exports, not catalog entries, since a story keeps
  its entry after its component stops being exported. After an upgrade, `proposed/<Name>` resolves to the kit's export
  of that name, in the check and on the canvas, so the blocks use the library's component at once with no tag, and the
  Inspector lists it under "Now in the kit". A `proposed_in_kit` warning tells the agent to switch the import to `"kit"`.
- **Promote** starts the thread with `t3 thread start`, then reads the thread once to keep its link for the Inspector's
  Open thread. The message tells the thread that `"kit"` is the library's own entry, and names any layout primitive the
  component leans on that Brainstorm generated, so the thread writes it rather than importing what the library lacks.
