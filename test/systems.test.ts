import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import type { FileMap, ProposedName, Result, SessionId, SystemId, ThreadId } from "../src/core/types";
import { FakeBridge } from "./fakeBridge";

const checker = createChecker({ size: 2 });
const T1 = "11111111-1111-1111-1111-111111111111" as ThreadId;
const S = "s_kitkit01" as SessionId;
const SYS = "ds_fixture01" as SystemId;
const AT = "2026-11-08T10:00:00.000Z";

// A copy inside the repo, so the library still resolves react and tailwindcss from the repo's node_modules, and the
// upgrade test can change it.
const lib = mkdtempSync(join(import.meta.dirname, ".kit-"));
cpSync(join(import.meta.dirname, "kit-lib"), lib, { recursive: true });

let service: Brainstorm;
let bridge: FakeBridge;
let exportsDir: string;

const data = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error, null, 2));
  return result.data;
};

const blockJson = JSON.stringify({ title: "Chores", props: {} });

function copy(base: number | null, tsx: string, extra: FileMap = {}): FileMap {
  return {
    "brainstorm.json": JSON.stringify({ format: 1, session: S, base, slots: [{ id: "home", title: "Home" }] }),
    "slots/home/a/block.tsx": tsx,
    "slots/home/a/block.json": blockJson,
    ...extra,
  };
}

const kitBlock = `import { Button, Card, CardBody, CardTitle, Stack } from "kit";
export default function Chores() {
  return (
    <Card>
      <Stack gap="3">
        <CardTitle>Chores</CardTitle>
        <CardBody>Three left</CardBody>
        <Button>Spin</Button>
      </Stack>
    </Card>
  );
}
`;

const usesProposed = `import { Card, Stack } from "kit";
import ChoreList from "proposed/ChoreList";
export default function Chores() {
  return (
    <Card>
      <Stack gap="3">
        <ChoreList items={["Dishes", "Bins"]} />
      </Stack>
    </Card>
  );
}
`;

const choreListTsx = `import { Text } from "kit";
export default function ChoreList({ items }) {
  return (
    <ul className="chore-list">
      {items.map((item) => (
        <li key={item} className="rounded-md border border-border"><Text size="sm">{item}</Text></li>
      ))}
    </ul>
  );
}
`;
const choreListJson = JSON.stringify({ title: "Chore list", description: "The week's chores, one row each", tier: "primitive", example: { items: ["Dishes"] } });

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "bs-systems-"));
  exportsDir = join(home, "exports");
  bridge = new FakeBridge();
  bridge.add(T1, "proj-a", "Design thread");
  service = await Brainstorm.open({
    dbPath: join(home, "brainstorm.db"),
    exportsDir,
    bridge,
    checker,
    now: () => AT,
    newSessionId: () => S,
  });
  // The service makes its own ids; this test names the one it expects through the store's first system.
}, 120_000);

afterAll(async () => {
  await checker.close();
  rmSync(lib, { recursive: true, force: true });
});

let system: SystemId = SYS;

/** The session's upgrade check, once the background check has finished. */
async function upgradeCheck(): Promise<unknown> {
  for (let i = 0; i < 200; i++) {
    const check = data(await service.view(S)).system?.upgrade.check;
    if (check?.state !== "checking") return check;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the upgrade check never finished");
}

describe("a design system", () => {
  test("syncs from a library's package folder: its kit, stories, theme and the primitives it lacks", async () => {
    const added = data(await service.systems.add({ path: lib, thread: T1 }));
    system = added.system.id;
    expect(added.created).toBe(true);
    expect(added.system.name).toBe("@fixture/kit");
    expect(added.system.projectId).toBe("proj-a");
    expect(added.system.latest).toMatchObject({ n: 1, components: 2, stories: 3, failedStories: 0 });
    const manifest = added.system.manifest!;
    expect(manifest.catalog.map((e) => [e.name, e.parts, e.stories.length, e.generated])).toEqual([
      ["Button", [], 2, false],
      ["Card", ["CardBody", "CardTitle"], 1, false],
      ["Box", [], 0, true],
      ["Grid", [], 0, true],
      ["Heading", [], 0, true],
      ["Stack", [], 0, true],
      ["Text", [], 0, true],
    ]);
    expect(manifest.styles.axes).toEqual([{ attribute: "data-theme", values: ["dark"], default: null }]);
    expect(manifest.styles.tokens.find((t) => t.name === "--primary")).toMatchObject({ kind: "color", value: "#4f46e5", byAxis: { "data-theme=dark": "#818cf8" } });
    expect(manifest.styles.measured.radius).toContain("8px");
    // Classes with parentheses, as shadcn's v4 components write them, reach the kit's CSS.
    const kit = data(await service.systems.kit(system, 1 as never));
    expect([kit.css.includes(".py-\\(--body-spacing\\)"), kit.css.includes("--body-spacing: calc(var(--spacing) * 2)")]).toEqual([true, true]);
    // So do classes with `>` and quotes inside their brackets, which shadcn writes for icons in buttons and alerts.
    expect([kit.css.includes(":has( > svg)"), kit.css.includes(":not([class*='size-'])")]).toEqual([true, true]);
  }, 120_000);

  test("syncing an unchanged library makes no new version", async () => {
    const again = data(await service.systems.sync(system));
    expect(again.created).toBe(false);
    expect(again.system.versions.map((v) => v.n)).toEqual([1]);
  }, 120_000);
});

describe("a session with a design system", () => {
  test("builds blocks from the kit, and pull gives the agent the catalog and stories", async () => {
    data(await service.newSession({ title: "Chores", brief: "", thread: T1, projectPath: null, system: "@fixture/kit" }));
    const committed = data(await service.commit({ session: S, thread: T1, files: copy(null, kitBlock), addresses: [], note: null }));
    expect(committed.created).toBe(true);
    const { files } = data(await service.pull(S));
    expect(files["system/CATALOG.md"]).toContain("### Card\nParts: `CardBody`, `CardTitle`");
    expect(files["system/stories/src/Button.stories.tsx"]).toContain("export const Primary");
    expect(files["GUIDE.md"]).toContain("## Design system: @fixture/kit");
    const context = data(await service.context(S, T1));
    expect(context.system).toMatchObject({ id: system, name: "@fixture/kit", n: 1 });
  }, 120_000);

  test("refuses raw HTML, style props, block.css and names the kit doesn't export", async () => {
    const tsx = `import { Card, Sparkle } from "kit";
export default function Chores() {
  return <Card><div className="p-3" style={{ color: "red" }}>Hi</div><Sparkle /></Card>;
}
`;
    const result = await service.commit({ session: S, thread: T1, files: copy(1, tsx, { "slots/home/a/block.css": ".x { color: red; }" }), addresses: [], note: null });
    expect(result.ok).toBe(false);
    const issues = result.ok ? [] : result.error.code === "validation_failed" ? result.error.issues : [];
    expect(issues.map((i) => [i.code, i.file])).toEqual([
      // Sparkle is undefined, so it doesn't render; the rules it breaks are reported with that.
      ["render_error", "slots/home/a/block.tsx"],
      ["raw_element", "slots/home/a/block.tsx"],
      ["style_prop", "slots/home/a/block.tsx"],
      ["style_prop", "slots/home/a/block.tsx"],
      ["css_in_system", "slots/home/a/block.css"],
      ["unknown_component", "slots/home/a/block.tsx"],
    ]);
  }, 120_000);

  test("a proposed component is held to the kit's classes and scales", async () => {
    const offScale = { "proposed/ChoreList/component.tsx": choreListTsx.replace('className="chore-list"', 'className="chore-list fancy-rows"'), "proposed/ChoreList/component.json": choreListJson, "proposed/ChoreList/component.css": ".chore-list { padding: 13px; border-radius: 8px; margin: calc(var(--spacing) * 3.25); gap: var(--made-up); }\n" };
    const bad = await service.commit({ session: S, thread: T1, files: copy(1, usesProposed, offScale), addresses: [], note: null });
    const issues = bad.ok ? [] : bad.error.code === "validation_failed" ? bad.error.issues : [];
    expect(issues.map((i) => [i.code, i.message.split(";")[0]])).toEqual([
      ["unknown_class", expect.stringContaining("fancy-rows")],
      // A literal where the kit reads a token would miss a theme tweak, and a promoted copy would carry the pixels.
      ["untokened_value", "padding: 13px doesn't follow the theme"],
      ["untokened_value", "border-radius: 8px doesn't follow the theme"],
      ["off_scale_value", "margin: calc(var(--spacing) * 3.25) is off the kit's spacing scale (13px)"],
      ["off_scale_value", "gap reads --made-up, which the kit doesn't define"],
    ]);
    expect(issues[2]?.message).toBe("border-radius: 8px doesn't follow the theme; write var(--radius), which is 8px in the kit");
    expect(issues[3]?.message).toMatch(/; use 12px, the nearest the kit uses, or another of /);

    const good = { ...offScale, "proposed/ChoreList/component.tsx": choreListTsx, "proposed/ChoreList/component.css": ".chore-list { display: flex; flex-direction: column; gap: calc(var(--spacing) * 2); border-radius: var(--radius); }\n" };
    data(await service.commit({ session: S, thread: T1, files: copy(1, usesProposed, good), addresses: [], note: null }));
    const view = data(await service.view(S));
    expect(view.iteration?.proposed.map((p) => [p.name, p.title, p.usedBy])).toEqual([["ChoreList", "Chore list", ["home/a"]]]);
    expect(view.system?.proposed).toEqual([
      { name: "ChoreList", title: "Chore list", description: "The week's chores, one row each", tier: "primitive", usedBy: ["home/a"], promotion: null, inSystem: null, fromKit: false },
    ]);
  }, 120_000);

  test("a theme's tweaks belong to the session, and can be saved to the system and exported", async () => {
    data(await service.act(S, { kind: "set_theme_axis", axis: "data-theme", value: "dark" }));
    data(await service.act(S, { kind: "set_theme_token", token: "--primary", value: "#e11d48" }));
    expect((await service.act(S, { kind: "set_theme_token", token: "--nope", value: "red" })).ok).toBe(false);
    data(await service.act(S, { kind: "save_theme", name: "Rose night" }));
    const view = data(await service.view(S));
    expect(view.system?.theme).toEqual({ axes: { "data-theme": "dark" }, tokens: { "--primary": "#e11d48" } });
    expect(view.system?.themes.map((t) => t.name)).toEqual(["Rose night"]);
    const exported = data(service.exportTheme(S));
    expect(readFileSync(exported.css.path, "utf8")).toContain("--primary: #e11d48;");
    expect(JSON.parse(readFileSync(exported.json.path, "utf8"))).toMatchObject({ primary: { $type: "color", $value: "#e11d48" } });
    data(await service.act(S, { kind: "reset_theme" }));
    data(await service.act(S, { kind: "apply_theme", name: "Rose night" }));
    expect(data(await service.view(S)).system?.theme.tokens).toEqual({ "--primary": "#e11d48" });
  }, 120_000);

  test("Promote starts a thread on the library's project with the component's files", async () => {
    data(await service.act(S, { kind: "promote", name: "ChoreList" as ProposedName }));
    const started = bridge.started.at(-1);
    expect(started?.project).toBe("proj-a");
    expect(started?.message.split("\n")[0]).toBe(`[brainstorm] promote ChoreList from session ${S} ("Chores")`);
    expect(started?.message).toContain(choreListTsx.trimEnd());
    // The library has no Text of its own, so the thread is told it was a stand-in rather than left to import it.
    expect(started?.message).toContain("- Text is a layout primitive Brainstorm generated because the library has none.");
    expect(data(await service.view(S)).system?.proposed[0]?.promotion).toMatchObject({ state: "started", link: `https://app.t3.codes/threads/p/${started?.thread}` });
  }, 120_000);

  test("upgrade moves to a new version only when the design still builds with it", async () => {
    // Version 2 drops CardBody, which the design doesn't use, and adds ChoreList.
    writeFileSync(join(lib, "src/index.ts"), 'export { Button } from "./Button";\nexport { Card, CardBody, CardTitle } from "./Card";\nexport function ChoreList() { return null; }\n');
    const heard: string[] = [];
    const stop = service.subscribe((session) => heard.push(session));
    const v2 = data(await service.systems.sync(system));
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(v2.created).toBe(true);
    // An open session hears of the version at once, so its Inspector can offer the upgrade.
    expect(heard).toEqual([S]);
    const before = data(await service.view(S)).system;
    expect([before?.n, before?.latest, before?.proposed[0]?.inSystem]).toEqual([1, 2, 2]);
    // The upgrade says what it brings, so Rob can tell why it's worth taking.
    expect(before?.upgrade).toMatchObject({ added: ["ChoreList"], removed: [] });
    // Brainstorm checks the design against the new version in the background, so the offer can say nothing breaks.
    expect(await upgradeCheck()).toEqual({ state: "clean" });
    data(await service.act(S, { kind: "upgrade_system" }));
    const upgraded = data(await service.view(S)).system;
    // The kit exports ChoreList now, so the blocks that import proposed/ChoreList get the kit's, untagged.
    expect([upgraded?.n, upgraded?.proposed[0]?.fromKit]).toEqual([2, true]);

    // Version 3 drops Card, which it does use.
    writeFileSync(join(lib, "src/index.ts"), 'export { Button } from "./Button";\nexport { CardBody, CardTitle } from "./Card";\n');
    data(await service.systems.sync(system));
    expect(await upgradeCheck()).toEqual({ state: "breaks", errors: 2, where: ["home/a"] });
    const refused = await service.act(S, { kind: "upgrade_system" });
    expect(refused.ok ? null : refused.error.message).toBe("version 3 breaks this design in 2 places, so the session stays on version 2");
    expect(data(await service.view(S)).system?.n).toBe(2);
    // Each version lists what it changed and which brainstorms sit on it.
    const versions = data(service.systems.view(system)).versions.map((v) => ({ n: v.n, added: v.added, removed: v.removed, sessions: v.sessions.map((s) => s.id) }));
    expect(versions).toEqual([
      { n: 3, added: [], removed: ["Card", "ChoreList"], sessions: [] },
      { n: 2, added: ["ChoreList"], removed: [], sessions: [S] },
      { n: 1, added: [], removed: [], sessions: [] },
    ]);
  }, 240_000);

  test("a freeform session refuses proposed components", async () => {
    const { service: other } = await (async () => {
      const home = mkdtempSync(join(tmpdir(), "bs-free-"));
      const b = new FakeBridge();
      b.add(T1, "proj-a", "Design thread");
      return { service: await Brainstorm.open({ dbPath: join(home, "db"), exportsDir: join(home, "x"), bridge: b, checker, now: () => AT, newSessionId: () => S }) };
    })();
    data(await other.newSession({ title: "Free", brief: "", thread: T1, projectPath: null }));
    const files = copy(null, "export default function A() { return <div />; }\n", {
      "proposed/ChoreList/component.tsx": choreListTsx,
      "proposed/ChoreList/component.json": choreListJson,
    });
    const result = await other.commit({ session: S, thread: T1, files, addresses: [], note: null });
    expect(result.ok ? [] : result.error.code === "validation_failed" ? result.error.issues.map((i) => i.code) : []).toEqual(["invalid_proposed"]);
  }, 120_000);
});
