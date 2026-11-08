import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import type { FileMap, Result, SessionId, SystemCheck, SystemId, ThreadId } from "../src/core/types";
import { FakeBridge } from "./fakeBridge";

// ADR 008: a design system from an app's own components, through an adapter an agent writes.

const checker = createChecker({ size: 2 });
const T1 = "22222222-2222-2222-2222-222222222222" as ThreadId;
const S = "s_appkit01" as SessionId;
const AT = "2026-11-08T12:00:00.000Z";

// A copy inside the repo, so the app resolves react and tailwindcss from the repo's node_modules.
const app = mkdtempSync(join(import.meta.dirname, ".kit-app-"));
cpSync(join(import.meta.dirname, "app-fixture"), app, { recursive: true });

let service: Brainstorm;
let bridge: FakeBridge;
let system: SystemId;

const data = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error, null, 2));
  return result.data;
};

const gates = (c: SystemCheck) => Object.fromEntries(c.gates.map((g) => [g.gate, g.passed]));

const write = (rel: string, text: string) => {
  mkdirSync(join(app, rel, ".."), { recursive: true });
  writeFileSync(join(app, rel), text);
};

const adapter = (extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      name: "Fixture app",
      primitives: ["src/components/ui/*.tsx"],
      composites: ["src/components/meal/*.tsx"],
      shared: ["src/lib/utils.ts"],
      stylesheet: "src/styles.css",
      aliases: { "@/": "src/" },
      ...extra,
    },
    null,
    2,
  );

const STORIES = {
  ".brainstorm/stories/button.stories.tsx": `import { Button } from "../../src/components/ui/button";
export default {
  component: Button,
  argTypes: { variant: { control: "select", options: ["primary", "outline"] } },
};
export const Primary = { args: { children: "Save", variant: "primary" } };
`,
  ".brainstorm/stories/badge.stories.tsx": `import Badge from "../../src/components/ui/badge";
export default { component: Badge };
export const Time = { args: { children: "20 min" } };
`,
  ".brainstorm/stories/meal-card.stories.tsx": `import { MealCard } from "../../src/components/meal/meal-card";
export default { component: MealCard };
export const Default = { args: { title: "Lentil soup", time: "35 min" } };
`,
};

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "bs-app-systems-"));
  bridge = new FakeBridge();
  bridge.add(T1, "proj-app", "App thread");
  service = await Brainstorm.open({ dbPath: join(home, "brainstorm.db"), exportsDir: join(home, "exports"), bridge, checker, now: () => AT, newSessionId: () => S });
}, 120_000);

afterAll(async () => {
  await checker.close();
  rmSync(app, { recursive: true, force: true });
});

describe("a design system from an app project", () => {
  test("an app's components folder isn't a library, so adding it fails in a way the window can answer with an import", async () => {
    for (const folder of [app, join(app, "src/components")]) {
      const added = await service.systems.add({ path: folder });
      const codes = added.ok ? [] : added.error.code === "validation_failed" ? added.error.issues.map((i) => i.code) : [added.error.code];
      expect(codes).toEqual(["no_system"]);
    }
  });

  test("an import starts an agent on the T3 project that holds the folder, from its root", async () => {
    // Brainstorm learns which project holds a folder when a brainstorm starts there.
    data(await service.newSession({ title: "Meals", brief: "", thread: T1, projectPath: app }));
    const started = data(await service.systems.importProject({ path: join(app, "src/components/ui") }));
    expect(started).toMatchObject({ root: app, projectId: "proj-app", state: "started" });
    const message = bridge.started.at(-1)?.message ?? "";
    expect(message.split("\n")[0]).toBe(`[brainstorm] import the design system from ${app}`);
    expect(message).toContain("Rob pointed Brainstorm at `src/components/ui`");
    expect(message).toContain(`brainstorm system check ${app}`);
    expect(message).toContain(`brainstorm system add ${app}`);
    expect(service.systems.imports().map((i) => i.root)).toEqual([app]);
  });

  test("the check fails the boundary for a component that reads app state, and the stories gate for missing stories", async () => {
    write(".brainstorm/system.json", adapter());
    const c = data(await service.systems.check(app));
    expect(gates(c)).toEqual({ builds: true, boundary: false, stories: false, theme: true });
    const boundary = c.gates.find((g) => g.gate === "boundary")?.issues ?? [];
    expect(boundary.map((i) => i.message.split(";")[0])).toEqual(["src/components/ui/user-chip.tsx imports src/store.ts, which isn't in the system"]);
    // A file's default export joins the kit under its file's name; the meal folder is the composites.
    expect(c.components.map((x) => [x.name, x.tier, x.stories]).sort()).toEqual([
      ["Badge", "primitive", 0],
      ["Button", "primitive", 0],
      ["MealCard", "composite", 0],
      ["UserChip", "primitive", 0],
    ]);
  }, 120_000);

  test("excluding the component and writing stories passes every gate, and add takes the project's adapter", async () => {
    write(".brainstorm/system.json", adapter({ exclude: ["src/components/ui/user-chip.tsx"] }));
    for (const [file, text] of Object.entries(STORIES)) write(file, text);
    const c = data(await service.systems.check(app));
    expect(gates(c)).toEqual({ builds: true, boundary: true, stories: true, theme: true });

    const added = data(await service.systems.add({ path: app }));
    system = added.system.id;
    expect(added.system).toMatchObject({ name: "Fixture app", adapter: true, syncError: null });
    expect(added.system.source).toMatchObject({ entry: null, adapter: join(app, ".brainstorm", "system.json") });
    const manifest = added.system.manifest!;
    expect(manifest.catalog.filter((e) => !e.generated).map((e) => [e.name, e.tier])).toEqual([
      ["Badge", "primitive"],
      ["Button", "primitive"],
      ["MealCard", "composite"],
    ]);
    const button = manifest.stories.find((s) => s.exportName === "Primary");
    expect(button?.argTypes).toEqual({ variant: { control: "select", options: ["primary", "outline"], description: null } });
    expect(button?.htmlHash).toMatch(/^[0-9a-f]{16}$/);
    // The import that wrote this adapter is done.
    expect(service.systems.imports()).toEqual([]);
  }, 120_000);

  test("auto-sync syncs only a changed project, and the version says what renders differently", async () => {
    expect(await service.systems.syncChanged()).toEqual([]);
    const button = join(app, "src/components/ui/button.tsx");
    writeFileSync(button, readFileSync(button, "utf8").replace("px-3 py-2", "px-4 py-2"));
    write("src/styles.css", readFileSync(join(app, "src/styles.css"), "utf8").replace("--radius: 0.5rem;", "--radius: 0.75rem;"));
    expect(await service.systems.syncChanged()).toEqual([system]);
    const view = data(service.systems.view(system));
    expect(view.versions[0]).toMatchObject({
      n: 2,
      added: [],
      removed: [],
      // MealCard renders a Button, so its story changes too.
      changed: [
        { name: "Button", stories: 1 },
        { name: "MealCard", stories: 1 },
      ],
      tokens: [{ name: "--radius", before: "0.5rem", after: "0.75rem" }],
    });
    expect(await service.systems.syncChanged()).toEqual([]);
  }, 240_000);

  test("a sync that fails is kept on the system, and isn't retried until the project changes", async () => {
    write(".brainstorm/system.json", adapter({ exclude: ["src/components/ui/user-chip.tsx"], stylesheet: "src/missing.css" }));
    expect(await service.systems.syncChanged()).toEqual([system]);
    const failed = data(service.systems.view(system));
    expect(failed.syncError?.issues.map((i) => i.code)).toEqual(["invalid_adapter"]);
    expect(await service.systems.syncChanged()).toEqual([]);
    // Repair starts an agent with what went wrong.
    data(await service.systems.importProject({ path: app, repair: system }));
    const message = bridge.started.at(-1)?.message ?? "";
    expect(message.split("\n")[0]).toBe(`[brainstorm] repair the Fixture app design system (${system})`);
    expect(message).toContain('"stylesheet" src/missing.css doesn\'t exist');
    write(".brainstorm/system.json", adapter({ exclude: ["src/components/ui/user-chip.tsx"] }));
    expect(await service.systems.syncChanged()).toEqual([system]);
    expect(data(service.systems.view(system)).syncError).toBeNull();
  }, 240_000);
});

describe("tiers in a session", () => {
  const blockJson = JSON.stringify({ title: "Meals", props: {} });
  const copy = (base: number | null, extra: FileMap): FileMap => ({
    "brainstorm.json": JSON.stringify({ format: 1, session: S2, base, slots: [{ id: "home", title: "Home" }] }),
    "slots/home/a/block.tsx": `import { Stack } from "kit";\nimport WeekStrip from "proposed/WeekStrip";\nexport default function Meals() { return <Stack gap="3"><WeekStrip days={["Mon", "Tue"]} /></Stack>; }\n`,
    "slots/home/a/block.json": blockJson,
    ...extra,
  });
  const S2 = "s_appkit02" as SessionId;
  const strip = (tier: string | null) =>
    JSON.stringify({ title: "Week strip", description: "The week's days", ...(tier === null ? {} : { tier }), example: { days: ["Mon"] } });

  test("a new proposed component must say its tier, and a composite composes the kit with no HTML", async () => {
    const other = await (async () => {
      const home = mkdtempSync(join(tmpdir(), "bs-tiers-"));
      const b = new FakeBridge();
      b.add(T1, "proj-app", "App thread");
      return Brainstorm.open({ dbPath: join(home, "db"), exportsDir: join(home, "x"), bridge: b, checker, now: () => AT, newSessionId: () => S2 });
    })();
    data(await other.systems.add({ path: app }));
    data(await other.newSession({ title: "Meals", brief: "", thread: T1, projectPath: app, system: "Fixture app" }));
    const commit = (files: FileMap) => other.commit({ session: S2, thread: T1, files, addresses: [], note: null });
    const codes = (r: Awaited<ReturnType<typeof commit>>) => (r.ok ? [] : r.error.code === "validation_failed" ? r.error.issues.filter((i) => i.severity === "error").map((i) => i.code) : [r.error.code]);

    const html = `export default function WeekStrip({ days }) { return <ul>{days.map((d) => <li key={d}>{d}</li>)}</ul>; }\n`;
    const composed = `import { Badge, Stack } from "kit";\nexport default function WeekStrip({ days }) { return <Stack gap="2">{days.map((d) => <Badge key={d}>{d}</Badge>)}</Stack>; }\n`;

    expect(codes(await commit(copy(null, { "proposed/WeekStrip/component.tsx": composed, "proposed/WeekStrip/component.json": strip(null) })))).toEqual(["missing_tier"]);
    const refused = await commit(copy(null, { "proposed/WeekStrip/component.tsx": html, "proposed/WeekStrip/component.json": strip("composite") }));
    expect(codes(refused)).toEqual(["raw_element", "raw_element"]);
    expect(refused.ok ? "" : refused.error.code === "validation_failed" ? refused.error.issues[0]?.message : "").toContain("a proposed composite composes the kit's components");
    expect(codes(await commit(copy(null, { "proposed/WeekStrip/component.tsx": composed, "proposed/WeekStrip/component.json": strip("composite") })))).toEqual([]);
    // The catalog leads with composites, so the agent reuses before it proposes.
    const pulled = data(await other.pull(S2));
    const catalog = pulled.files["system/CATALOG.md"] ?? "";
    expect(catalog.indexOf("### Composites")).toBeGreaterThan(-1);
    expect(catalog.indexOf("### Composites")).toBeLessThan(catalog.indexOf("### Primitives"));
    expect(catalog).toContain("Choices: `variant` \"primary\" | \"outline\"");
    other.close();
  }, 240_000);
});
