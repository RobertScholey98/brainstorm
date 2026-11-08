import type { Issue } from "../types";
import { ADAPTER_FILE } from "./source";

/**
 * The first turn of the T3 thread that imports a project's design system (ADR 008). The agent's output is fixed: an
 * adapter and the missing stories, both in the project. `brainstorm system check` decides when it is done, so the
 * brief says what to decide and how to know it's right, not how to write each file.
 */
const issueLine = (i: Issue) => `${i.file ?? "brainstorm"}${i.pointer === null ? "" : `#${i.pointer}`}: ${i.code}: ${i.message}`;

export function importMessage(input: {
  readonly root: string;
  /** The folder Rob chose, relative to the root; empty when he chose the root. */
  readonly chosen: string;
  readonly repair: { readonly id: string; readonly name: string; readonly issues: readonly Issue[] } | null;
}): string {
  const { root, chosen, repair } = input;
  const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text.trimEnd()}\n\`\`\``;
  const intro =
    repair === null
      ? [
          `[brainstorm] import the design system from ${root}`,
          "",
          `Rob wants Brainstorm designs built from this project's own components, so a design can be built as drawn. Brainstorm syncs a design system from the project's files, every time they change, through an adapter at ${ADAPTER_FILE}. Your job is to write that adapter, and a story for each component that has none, then add the system.`,
          ...(chosen === "" ? [] : ["", `Rob pointed Brainstorm at \`${chosen}\`, so start there; the system may also include components elsewhere in the project.`]),
        ]
      : [
          `[brainstorm] repair the ${repair.name} design system (${repair.id})`,
          "",
          `Brainstorm syncs this project's design system through ${ADAPTER_FILE}, and the last sync failed:`,
          "",
          ...repair.issues.slice(0, 20).map((i) => `- ${issueLine(i)}`),
          "",
          "Find what in the project changed, such as a moved or renamed file, and fix the adapter or the stories so it syncs again. Change the project's components only if Rob asks.",
        ];
  return [
    ...intro,
    "",
    "## What to decide",
    "",
    "- **Which components are the design system.** Reusable, presentational components: they take props and render. Leave out app features, screens, and anything that reads app state, fetches data or uses the router.",
    "- **Each one's tier.** A primitive is a basic control or element, such as Button, Input or Badge. A composite is built from other components for one purpose, such as a meal card. A layout arranges other content around slots (`children` or named props), such as an app shell.",
    "- **What the components need to render.** Shared helpers such as a `cn()` function go in `shared`. A provider the canvas can't run, such as a router or query client, gets a stub file in `.brainstorm/stubs/` named in `stubs`.",
    "",
    "## What to write",
    "",
    `\`${ADAPTER_FILE}\`, with paths relative to ${root}:`,
    "",
    fence(
      "jsonc",
      JSON.stringify(
        {
          name: "the system's name",
          primitives: ["src/components/ui/*.tsx"],
          composites: ["src/components/cards/*.tsx"],
          layouts: [],
          exclude: ["src/components/ui/app-sidebar.tsx"],
          shared: ["src/lib/utils.ts"],
          stylesheet: "src/styles.css",
          aliases: { "@/": "src/" },
          stories: [".brainstorm/stories/**/*.stories.tsx"],
          frame: null,
          stubs: {},
        },
        null,
        2,
      ),
    ),
    "",
    "- `aliases` maps the import prefixes the components use to folders, as the project's tsconfig `paths` do.",
    "- `stylesheet` is the CSS the components are themed by: the file that defines the colour tokens, often the one shadcn's `components.json` names.",
    "- `stories` keeps the project's existing Storybook globs, if it has any, and adds `.brainstorm/stories/**/*.stories.tsx`.",
    "- Leave `entry` out when the components are files in the project. Name it only for a library whose index exports them all.",
    "",
    "**Stories.** Every component needs at least one story that renders it with realistic content, in Component Story Format. Write the missing ones in `.brainstorm/stories/`, one file per component. Import each component by its path in the project, set `component` in the meta, and give each story `args` rather than a render function where the props allow it. Brainstorm turns the args into the props table and live controls. For a prop with a fixed set of values, add `argTypes: { variant: { control: \"select\", options: [...] } }`. Set the tier with `tags: [\"composite\"]` or `tags: [\"layout\"]` in the meta when a component's file isn't under that tier's glob.",
    "",
    "## How to know it's done",
    "",
    fence("sh", `brainstorm system check ${root}`),
    "",
    "It syncs without saving anything and reports four gates:",
    "",
    "- **builds**: the kit and its CSS compile.",
    "- **boundary**: no component imports a project file that isn't in the system, `shared`, a story or a stub. When one does, exclude the component, stub what it reads, or list a genuine helper in `shared`.",
    "- **stories**: every component has a story that renders something.",
    "- **theme**: the stylesheet defines colour tokens.",
    "",
    `Run it until every gate passes. Then run ${repair === null ? `\`brainstorm system add ${root}\`` : `\`brainstorm system sync ${repair.id}\``}.`,
    "",
    "## Report",
    "",
    "End with a short report for Rob: the components you included under each tier, the ones you left out and why, any stubs you wrote, and any warning the check still shows. Don't change the project's components to make them pass; leave them out and say so.",
  ].join("\n");
}
