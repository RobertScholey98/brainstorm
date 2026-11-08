// Captures design systems from an app project (ADR 008) end to end, for a design review round:
//
//   node scripts/capture/app-systems.mjs --round <n>
//
// It drives the built app the way Rob and an agent would, on a copy of test/app-fixture (a small shadcn-style app with
// a meal card): Rob adds the app's components folder, which isn't a library, and starts an agent import; the agent
// writes the adapter and stories, runs the check until it passes, and adds the system. Rob reviews the import: he
// steps through the components, raises an issue, moves a layout out of the primitives and sends that to the agent,
// with v2 synced from it, then confirms it. He opens a story in the workbench and changes its args. Then the
// project changes under a brainstorm built with the system: auto-sync makes v3 (what renders differently), v4 drops a
// component a block uses (the upgrade check says what breaks), and a broken adapter fails the sync, which Rob repairs
// with an agent.
//
// Writes design-review/app-systems/round-<n>/<NN-name>.png and a manifest.json that names what each shot shows.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, demoEnv } from "../seed-demo.mjs";
import { build, canvasFrame, launch, root } from "../verify/electron.mjs";

const { values } = parseArgs({ options: { round: { type: "string" } } });
const round = Number(values.round);
if (values.round === undefined || !Number.isInteger(round) || round < 0) {
  console.error("usage: node scripts/capture/app-systems.mjs --round <n>");
  process.exit(1);
}
const out = join(root, "design-review", "app-systems", `round-${round}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const manifest = [];
let shotN = 0;
const name = (slug) => `${String(++shotN).padStart(2, "0")}-${slug}.png`;

build();
// The app copy sits inside the repo, so it resolves react and tailwindcss from the repo's node_modules.
const app = mkdtempSync(join(root, "test", ".kit-app-capture-"));
cpSync(join(root, "test", "app-fixture"), app, { recursive: true });
const write = (rel, text) => {
  mkdirSync(join(app, rel, ".."), { recursive: true });
  writeFileSync(join(app, rel), text);
};

const home = mkdtempSync(join(tmpdir(), "bs-app-systems-capture-"));
writeFileSync(
  join(home, "fake-t3.json"),
  JSON.stringify({
    threads: {
      [DEMO_THREAD]: { projectId: "meals-app", title: "Meals app", status: "completed", activeRunId: null, latestRunId: null, pendingRequestCount: 0, messages: [] },
    },
  }),
);
const { ELECTRON_RUN_AS_NODE: _, ...env } = demoEnv(home);
const t3 = fakeT3(join(home, "fake-t3.json"));

const transcript = [];
function cli(args, { quiet = false } = {}) {
  const r = brainstorm(env, args, { cwd: app });
  if (!quiet) transcript.push(`$ brainstorm ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}\n${(r.stdout + r.stderr).trimEnd()}`);
  return r;
}
const json = (args) => {
  const r = brainstorm(env, [...args, "--json"], { cwd: app });
  if (r.json?.ok !== true) throw new Error(`brainstorm ${args.join(" ")} failed: ${r.stdout}${r.stderr}`);
  return r.json.data;
};

const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Draws text the way a terminal shows it, in a hidden window, for the shots of what the agent and the T3 thread see. */
async function textShot(electron, slug, title, text, about) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0f1115;color:#e6e8eb;font:13px/1.55 'Cascadia Mono',Consolas,monospace;padding:20px 24px"><div style="color:#8b93a1;margin-bottom:12px;font-family:system-ui,sans-serif;font-size:12px">${escape(title)}</div><pre style="white-space:pre-wrap;word-break:break-word;margin:0">${escape(text)}</pre></body>`;
  const png = await electron.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true } });
    await w.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
    const height = await w.webContents.executeJavaScript("document.documentElement.scrollHeight");
    w.setContentSize(1200, Math.min(Math.max(height, 200), 4000));
    await new Promise((r) => setTimeout(r, 400));
    const image = await w.webContents.capturePage();
    w.destroy();
    return image.toPNG().toString("base64");
  }, html);
  const file = name(slug);
  writeFileSync(join(out, file), Buffer.from(png, "base64"));
  manifest.push({ file, shows: about });
  console.log(`shot ${file}`);
}

async function shot(window, slug, about) {
  const file = name(slug);
  await window.mouse.move(1, 1);
  await new Promise((r) => setTimeout(r, 350));
  await window.screenshot({ path: join(out, file) });
  manifest.push({ file, shows: about });
  console.log(`shot ${file}`);
}

async function galleryFrame(window) {
  await window.waitForSelector('[data-gallery="true"]', { timeout: 60_000 });
  for (;;) {
    const frame = window.frames().find((f) => f.url().endsWith("/canvas"));
    if (frame !== undefined) return frame;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Waits for auto-sync to make version `n` of the system, or to record a failed sync. */
async function waitForSync(id, until) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const s = json(["system", "list"]).find((x) => x.id === id);
    if (until(s)) return s;
    if (Date.now() > deadline) throw new Error(`auto-sync didn't happen: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const adapter = (extra = {}) =>
  `${JSON.stringify(
    {
      name: "Meals app",
      primitives: ["src/components/ui/*.tsx"],
      composites: ["src/components/meal/*.tsx"],
      shared: ["src/lib/utils.ts"],
      stylesheet: "src/styles.css",
      aliases: { "@/": "src/" },
      stories: [".brainstorm/stories/**/*.stories.tsx"],
      ...extra,
    },
    null,
    2,
  )}\n`;

/** Changes the adapter as it stands, so the tiers the review wrote into it stay. */
const editAdapter = (change) => {
  const file = join(app, ".brainstorm", "system.json");
  writeFileSync(file, `${JSON.stringify(change(JSON.parse(readFileSync(file, "utf8"))), null, 2)}
`);
};

const STORIES = {
  ".brainstorm/stories/button.stories.tsx": `import { Button } from "../../src/components/ui/button";

export default {
  component: Button,
  argTypes: { variant: { control: "select", options: ["primary", "outline"], description: "How much the button stands out" } },
};

export const Primary = { args: { children: "Plan the week", variant: "primary" } };
export const Outline = { args: { children: "Skip", variant: "outline" } };
`,
  ".brainstorm/stories/badge.stories.tsx": `import Badge from "../../src/components/ui/badge";

export default { component: Badge };

export const Time = { args: { children: "20 min" } };
`,
  ".brainstorm/stories/meal-card.stories.tsx": `import { MealCard } from "../../src/components/meal/meal-card";

export default { component: MealCard, tags: ["composite"] };

export const Default = { args: { title: "Lentil soup", time: "35 min" } };
export const Quick = { args: { title: "Halloumi wraps", time: "15 min" } };
`,
  ".brainstorm/stories/page-frame.stories.tsx": `import { PageFrame } from "../../src/components/ui/page-frame";

export default { component: PageFrame };

export const Week = { args: { title: "This week", children: "Dinners go here" } };
`,
};

// The app keeps a page layout among its ui primitives, so the import's globs call it a primitive; Rob's review moves it.
const PAGE_FRAME = `import type { ReactNode } from "react";

export function PageFrame({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-4 rounded-md border border-border bg-background p-4 text-foreground">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}
`;

const run = await launch(home, env);
const { app: electron, window, errors } = run;
try {
  await electron.evaluate(({ BrowserWindow, nativeTheme }) => {
    nativeTheme.themeSource = "light";
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
  });
  await window.emulateMedia({ colorScheme: "light" });

  write("src/components/ui/page-frame.tsx", PAGE_FRAME);
  // Brainstorm learns the app's T3 project from a brainstorm started in it.
  cli(["session", "new", "--title", "Sketch", "--brief", "A loose sketch.", "--project", app], { quiet: true });

  // Rob points Brainstorm at the app's components folder.
  await window.click("[data-nav-systems]");
  await window.fill('[data-system-add] input', join(app, "src", "components"));
  await window.click("[data-system-add-button]");
  await window.waitForSelector("[data-system-none]", { timeout: 60_000 });
  await shot(window, "no-system", "Adding an app's components folder: it isn't a library's package and has no adapter, so instead of an error the page offers to import it with an agent and says what the agent will write");
  await window.click("[data-system-import]");
  await window.waitForSelector('[data-system-importing][data-import-state="started"]', { timeout: 30_000 });
  await shot(window, "import-started", "After Import with an agent: a card for the running import, with the project root, what the agent is doing, Open thread and Dismiss");
  const started = t3.started().at(-1);
  await textShot(electron, "import-message", `The thread the import started in project "${started?.project}": its first message`, started?.message ?? "(no thread started)", "The import thread's first message: what to decide (which components, their tiers, what they need), the adapter to write with an example, how to write stories with args and argTypes, the check's four gates, then system add and a report");

  // The agent writes the adapter, checks, fixes what the check names, and adds the system.
  write(".brainstorm/system.json", adapter());
  cli(["system", "check", app]);
  write(".brainstorm/system.json", adapter({ exclude: ["src/components/ui/user-chip.tsx"] }));
  for (const [file, text] of Object.entries(STORIES)) write(file, text);
  cli(["system", "check", app]);
  cli(["system", "add", app, "--thread", DEMO_THREAD]);
  await textShot(electron, "agent-import-cli", "What the import agent sees: a first check failing the boundary and stories gates, then a passing check and system add", transcript.join("\n\n"), "The import agent's terminal: the first check fails the boundary (UserChip imports the app's store) and the stories gate (no component has a story yet); after excluding UserChip and writing stories, every gate passes and system add syncs v1");

  const system = json(["system", "list"])[0];
  await window.waitForSelector(`[data-system="${system.id}"]`, { timeout: 30_000 });
  await window.waitForFunction(() => document.querySelector("[data-system-importing]") === null);
  await shot(window, "app-system-list", "Once the agent adds the system, the import card is gone (no reload) and the system is listed as awaiting Rob's review, with Review beside Sync");

  // Rob reviews the import, Storybook-style, before any brainstorm can use it.
  await window.click(`[data-system-review="${system.id}"]`);
  await window.waitForSelector("[data-system-review-callout]");
  await galleryFrame(window);
  await window.waitForSelector('[data-review-strip="MealCard"]');
  await new Promise((r) => setTimeout(r, 2000));
  await shot(window, "review-start", "Opening a system that awaits review: the review callout above the tabs, and the walk starting on the first component (MealCard, a composite) with its stories live, its tier switch, Raise an issue, and Previous / Next with 1 of 4");
  await window.click('[data-review-strip="MealCard"] [data-review-raise]');
  await window.fill("[data-review-note]", "The time should be optional; the week view shows a dinner before anyone knows how long it takes");
  await shot(window, "review-raise", "Raising an issue on MealCard: a note for the agent, which goes back with the rest of the review");
  await window.click("[data-review-raise-confirm]");
  await window.waitForSelector('[data-review-strip="MealCard"] [data-review-issue]');
  for (let i = 0; i < 4 && (await window.$('[data-review-strip="PageFrame"]')) === null; i++) await window.click("[data-review-next]");
  await window.click('[data-review-strip="PageFrame"] [data-review-tier="layout"]');
  await window.waitForSelector('[data-catalog-tier="Layouts"] [data-entry="PageFrame"]');
  await new Promise((r) => setTimeout(r, 1500));
  await shot(window, "review-moved", "After stepping to PageFrame and moving it to Layout: the catalog lists it under Layouts marked moved, MealCard shows its issue, the strip says moved from primitive, and the callout offers Send 2 changes to the agent while Confirm waits on the open issue");
  await window.click("[data-review-send]");
  await window.waitForFunction(() => document.querySelector("[data-review-status]")?.textContent?.includes("Sent"), null, { timeout: 30_000 });
  await shot(window, "review-sent", "After Send: Brainstorm wrote PageFrame's tier into the adapter and synced v2, so the catalog keeps it under Layouts; the issue and the move went to the import's thread, the callout says what was sent with Open thread, and Confirm is free again");
  const reviewSent = t3.sent().at(-1);
  await textShot(electron, "review-message", `What the review sent to the import's thread (${reviewSent?.thread})`, reviewSent?.message ?? "(nothing sent)", "The review's message to the import thread: Rob's note on MealCard, the tier move Brainstorm already wrote into the adapter's tiers, then check, sync and report");

  // Send synced the adapter it wrote, so v2 has PageFrame as a layout. Rob confirms it.
  await waitForSync(system.id, (s) => s.latest?.n === 2);
  await window.click("[data-review-confirm]");
  await window.waitForFunction(() => document.querySelector("[data-system-review-callout]") === null, null, { timeout: 30_000 });
  await window.locator("[data-catalog]").getByText("All stories").click();
  await galleryFrame(window);
  await new Promise((r) => setTimeout(r, 2000));
  await shot(window, "catalog-tiers", "After Rob confirms: no review callout; the catalog grouped into Layouts (PageFrame), Composites (MealCard) and Primitives (Badge, Button), then Brainstorm's generated primitives; every story live in the gallery");

  // Rob opens a story in the workbench.
  await window.click('[data-entry="Button"]');
  const gallery = await galleryFrame(window);
  await gallery.waitForSelector("[data-open-story]", { timeout: 30_000 });
  await gallery.click("[data-open-story]");
  await window.waitForSelector("[data-workbench]");
  await gallery.waitForSelector("[data-story-focused]", { timeout: 30_000 });
  await shot(window, "workbench", "Clicking a story's name opens it in the workbench: the one story, a width switch, and beside it Controls from its args and argTypes, the Props table with the variant's choices and description, and the Usage JSX with Copy");
  await window.click('[data-control-select="variant"]');
  await window.click('[role="option"]:has-text("outline")');
  await window.fill('[data-control="children"] input', "Plan next week");
  await window.click('[data-workbench-width="390"]');
  await gallery.waitForFunction(() => document.querySelector("[data-story-focused]")?.textContent?.includes("Plan next week"));
  await new Promise((r) => setTimeout(r, 600));
  await shot(window, "workbench-changed", "The workbench after two changes at 390px: the story re-renders as an outline button reading 'Plan next week', each changed control is marked with Reset 2 changes, and the Usage snippet follows");

  // A brainstorm built with v2 of the system, whose blocks use Button and Badge.
  const session = cli(["session", "new", "--title", "Meal week", "--brief", "Plan the week's dinners.", "--project", app, "--system", system.id]).stdout.match(/\bs_[a-z0-9]+/)?.[0];
  if (session === undefined) throw new Error(`session new failed:\n${transcript.at(-1)}`);
  const work = join(home, "work");
  cli(["pull", session, "--out", work], { quiet: true });
  const wc = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  writeFileSync(join(work, "brainstorm.json"), `${JSON.stringify({ ...wc, slots: [{ id: "week", title: "The week", frame: { width: 390, height: 520 } }] }, null, 2)}\n`);
  mkdirSync(join(work, "slots", "week", "plan"), { recursive: true });
  writeFileSync(
    join(work, "slots", "week", "plan", "block.tsx"),
    `import { Badge, Button, Heading, MealCard, Stack, Text } from "kit";

export default function Plan() {
  return (
    <Stack gap="4" padding="4" data-part="week">
      <Heading data-part="title">This week</Heading>
      <MealCard title="Lentil soup" time="35 min" />
      <MealCard title="Halloumi wraps" time="15 min" />
      <Stack direction="row" gap="2" align="center" data-part="foot">
        <Badge>2 of 7 planned</Badge>
        <Text tone="muted">Sam cooks Thursday</Text>
      </Stack>
      <Button>Plan the week</Button>
    </Stack>
  );
}
`,
  );
  writeFileSync(join(work, "slots", "week", "plan", "block.json"), `${JSON.stringify({ title: "Plan", props: {} }, null, 2)}\n`);
  const committed = cli(["commit", session, "--from", work, "--note", "A week from the app's own components"]);
  if (committed.code !== 0) throw new Error(`commit failed:\n${transcript.at(-1)}`);

  // The app's button gets roomier and its radius grows; auto-sync makes v3 within seconds, with no click.
  const button = join(app, "src", "components", "ui", "button.tsx");
  writeFileSync(button, readFileSync(button, "utf8").replace("px-3 py-2", "px-4 py-2"));
  write("src/styles.css", readFileSync(join(app, "src", "styles.css"), "utf8").replace("--radius: 0.5rem;", "--radius: 0.75rem;"));
  await waitForSync(system.id, (s) => s.latest?.n === 3);
  await window.click('[data-system-tab="versions"]');
  await window.waitForSelector('[data-version="3"]', { timeout: 30_000 });
  await shot(window, "versions-changed", "The Versions tab after auto-sync noticed the edit: v3 with its short hash, the components that render differently (~Button, and ~MealCard, which renders a Button) and the token that changed (--radius 0.5rem → 0.75rem)");

  await window.click(`[data-session="${session}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  const canvas = await canvasFrame(window);
  await canvas.waitForSelector('div[data-bid="week/plan"] [data-part="week"]', { timeout: 60_000 });
  await window.waitForSelector('[data-upgrade-check="clean"]', { timeout: 60_000 });
  await window.locator("[data-system-panel]").scrollIntoViewIfNeeded();
  await shot(window, "upgrade-clean", "The brainstorm on v2 offers v3, and has already checked it in the background: Nothing breaks, so Upgrade is safe");

  // The app retires Badge from the system; v4 would break the block that uses it.
  editAdapter((a) => ({ ...a, exclude: [...a.exclude, "src/components/ui/badge.tsx"] }));
  rmSync(join(app, ".brainstorm", "stories", "badge.stories.tsx"));
  await waitForSync(system.id, (s) => s.latest?.n === 4);
  await window.waitForSelector('[data-upgrade-check="breaks"]', { timeout: 60_000 });
  await window.locator("[data-system-panel]").scrollIntoViewIfNeeded();
  await shot(window, "upgrade-breaks", "After v4 drops Badge: the Inspector's upgrade callout turns to a warning naming the block it breaks (week/plan) and its error count, and Upgrade is disabled");

  // Someone moves the stylesheet; the next sync fails and is kept on the system.
  editAdapter((a) => ({ ...a, stylesheet: "src/theme.css" }));
  await waitForSync(system.id, (s) => s.syncError !== null);
  await window.click("[data-back]");
  await window.click("[data-nav-systems]");
  await window.waitForSelector(`[data-system="${system.id}"][data-system-failing]`, { timeout: 30_000 });
  await shot(window, "sync-error", "A sync that failed: the card keeps v4's counts, says why the last sync failed and when, and offers Repair with an agent beside Sync");
  await window.click(`[data-system="${system.id}"] button`);
  await window.waitForSelector("[data-system-sync-failed]");
  await shot(window, "sync-error-detail", "The system's page with the failed sync: a callout with the reason, that brainstorms stay on v4, and Repair with an agent");
  await window.click(`[data-system-sync-failed] [data-system-repair]`);
  await window.waitForFunction(() => document.querySelector("[data-system-repair]")?.textContent?.includes("Repairing"), null, { timeout: 30_000 });
  const repair = t3.started().at(-1);
  await textShot(electron, "repair-message", `The thread Repair started in project "${repair?.project}": its first message`, repair?.message ?? "(no thread started)", "The repair thread's first message: the failed sync's issues, to find what moved and fix the adapter or stories, then check and system sync");
} finally {
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify({ shots: manifest, errors }, null, 2)}\n`);
  await electron.close();
  rmSync(app, { recursive: true, force: true });
}
console.log(`${manifest.length} shots in ${out}`);
if (errors.length > 0) console.log(`window errors:\n${errors.join("\n")}`);
