# ADR 007: Design systems

Status: proposed. Rob asked for it on 2026-11-08: "create designs that exclusively use the design systems already in place", so a design "can simply be built from existing components". Rob settled the questions below in the same conversation. Nothing here is built yet.

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

```
design_system          id, name, source (projectPath, entry, storiesGlob, stubs, frame)
design_system_version  systemId, n, hash, bundle, css, tokens, measured, catalog, syncedAt
design_system_theme    systemId, name, tokens
session                + systemVersion (nullable, set at creation, changed only by upgrade)
theme_override         sessionId, token -> value
```

Proposed components are files of an iteration, alongside its blocks, so history, fork and vary carry them without new rules.

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
