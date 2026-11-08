// Captures design systems (ADR 007) end to end against a real React library, for a design review round:
//
//   node scripts/capture/systems.mjs --library <package folder> --round <n>
//
// It drives the built app the way Rob and an agent would: the agent adds the library with the CLI, builds a meal-plan
// study from its kit (scripts/demo/meal-plan) after one refused commit, and Rob tweaks the theme, saves and exports it,
// promotes the proposed WeekStrip, and upgrades once the library has it. For that last step the script adds a WeekStrip
// to the library and syncs; it removes those files again at the end, so point it at a clone you don't mind touching.
// The meal-plan blocks compose @robnet/ui's components, so the library is robnet's packages/ui.
//
// Writes design-review/systems/round-<n>/<NN-name>.png and a manifest.json that names what each shot shows.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, demoEnv } from "../seed-demo.mjs";
import { build, canvasFrame, launch, root, settled } from "../verify/electron.mjs";

const { values } = parseArgs({ options: { library: { type: "string" }, round: { type: "string" } } });
const round = Number(values.round);
if (values.library === undefined || values.round === undefined || !Number.isInteger(round) || round < 0) {
  console.error("usage: node scripts/capture/systems.mjs --library <package folder> --round <n>");
  process.exit(1);
}
const library = resolve(values.library);
const demo = join(root, "scripts", "demo", "meal-plan");
const out = join(root, "design-review", "systems", `round-${round}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const SLOTS = [
  { id: "week", title: "The week", frame: { width: 390, height: 760 } },
  { id: "recipe", title: "A recipe", frame: { width: 390 } },
];
const BRIEF = "Plan the flat's dinners for the week: who cooks what, and what still needs buying. Built from robnet's own UI kit.";

const manifest = [];
let shotN = 0;
const name = (slug) => `${String(++shotN).padStart(2, "0")}-${slug}.png`;

build();
const home = mkdtempSync(join(tmpdir(), "bs-systems-capture-"));
writeFileSync(
  join(home, "fake-t3.json"),
  JSON.stringify({
    threads: {
      [DEMO_THREAD]: { projectId: "robnet", title: "Meal plan study", status: "completed", activeRunId: null, latestRunId: null, pendingRequestCount: 0, messages: [] },
    },
  }),
);
const { ELECTRON_RUN_AS_NODE: _, ...env } = demoEnv(home);
const t3 = fakeT3(join(home, "fake-t3.json"));

const transcript = [];
function cli(args, { quiet = false } = {}) {
  const r = brainstorm(env, args, { cwd: home });
  if (!quiet) transcript.push(`$ brainstorm ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}\n${(r.stdout + r.stderr).trimEnd()}`);
  return r;
}
const json = (args) => {
  const r = brainstorm(env, [...args, "--json"], { cwd: home });
  if (r.json?.ok !== true) throw new Error(`brainstorm ${args.join(" ")} failed: ${r.stdout}${r.stderr}`);
  return r.json.data;
};

const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Draws text the way a terminal shows it, in a hidden window, for the shots of what the agent and the T3 thread see. */
async function textShot(app, slug, title, text, about) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0f1115;color:#e6e8eb;font:13px/1.55 'Cascadia Mono',Consolas,monospace;padding:20px 24px"><div style="color:#8b93a1;margin-bottom:12px;font-family:system-ui,sans-serif;font-size:12px">${escape(title)}</div><pre style="white-space:pre-wrap;word-break:break-word;margin:0">${escape(text)}</pre></body>`;
  const png = await app.evaluate(async ({ BrowserWindow }, html) => {
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
}

async function shot(window, slug, about, { clip, element } = {}) {
  const file = name(slug);
  // The pointer rests off the window's controls, so no hover or tooltip from the last click lands in the shot.
  await window.mouse.move(1, 1);
  await new Promise((r) => setTimeout(r, 350));
  if (element !== undefined) await element.screenshot({ path: join(out, file) });
  else await window.screenshot({ path: join(out, file), ...(clip === undefined ? {} : { clip }) });
  manifest.push({ file, shows: about });
  console.log(`shot ${file}`);
}

// The library gains the component Rob promotes, the way the promote thread would add it. Removed again at the end.
const promoted = {
  "src/components/ui/week-strip.tsx": `import { cn } from "cn"

type Day = { day: string; date: number; planned: boolean }

function WeekStrip({ days, selected, className, ...props }: React.ComponentProps<"ol"> & { days: Day[]; selected: string }) {
  return (
    <ol data-slot="week-strip" className={cn("grid grid-cols-7 gap-1", className)} {...props}>
      {days.map((d) => (
        <li
          key={d.day}
          data-selected={d.day === selected || undefined}
          className="group flex flex-col items-center gap-0.5 rounded-lg border bg-card py-2 text-card-foreground data-selected:border-primary data-selected:bg-primary data-selected:text-primary-foreground"
        >
          <span className="text-xs text-muted-foreground group-data-selected:text-primary-foreground">{d.day}</span>
          <span className="text-base font-semibold">{d.date}</span>
          <span className={cn("size-1.5 rounded-full", d.planned && "bg-primary group-data-selected:bg-primary-foreground")} />
        </li>
      ))}
    </ol>
  )
}

export { WeekStrip }
`,
  "src/stories/week-strip.stories.tsx": `import type { Meta, StoryObj } from '@storybook/react-vite';
import { WeekStrip } from '../components/ui/week-strip';

const meta = {
  title: 'Components/WeekStrip',
  component: WeekStrip,
  args: {
    selected: 'Tue',
    days: [
      { day: 'Mon', date: 10, planned: true },
      { day: 'Tue', date: 11, planned: true },
      { day: 'Wed', date: 12, planned: true },
      { day: 'Thu', date: 13, planned: false },
      { day: 'Fri', date: 14, planned: false },
      { day: 'Sat', date: 15, planned: true },
      { day: 'Sun', date: 16, planned: false },
    ],
  },
} satisfies Meta<typeof WeekStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
`,
};
const indexPath = join(library, "src", "index.ts");
const indexBefore = readFileSync(indexPath, "utf8");
const restoreLibrary = () => {
  writeFileSync(indexPath, indexBefore);
  for (const p of Object.keys(promoted)) rmSync(join(library, p), { force: true });
};

const run = await launch(home, env);
const { app, window, errors } = run;
try {
  await app.evaluate(({ BrowserWindow, nativeTheme }) => {
    nativeTheme.themeSource = "light";
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900);
  });
  await window.emulateMedia({ colorScheme: "light" });

  // The agent adds the library and starts a study with it, in robnet, the project the library lives in.
  const project = resolve(library, "..", "..");
  cli(["system", "add", library, "--thread", DEMO_THREAD]);
  const system = json(["system", "list"])[0];

  // Rob reviews the newly added library before a brainstorm can build with it. It came from its package, so nothing
  // sorted it into tiers; he confirms it as it is, which leaves it at v1 with no adapter.
  await window.click("[data-nav-systems]");
  await window.click(`[data-system-review="${system.id}"]`);
  await window.waitForSelector("[data-system-review-callout]");
  await window.waitForSelector('[data-gallery="true"]', { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2500));
  await shot(window, "library-review", "Reviewing a library added from its package: the callout says nothing sorted it into tiers and offers Sort into tiers with an agent beside Confirm; the walk starts on its first component, 1 of 72, with the tier switch");
  // Rob steps on with the arrow keys, then goes back to the first: Next unseen jumps past what he has seen.
  for (let i = 0; i < 3; i++) await window.keyboard.press("ArrowRight");
  await window.click('[data-entry="Accordion"]');
  await window.waitForSelector("[data-review-next-unseen]");
  await new Promise((r) => setTimeout(r, 1500));
  await shot(window, "library-review-walk", "After stepping three components with → and going back to Accordion: the walk says 1 of 72 · 4 seen, and Next unseen sits beside Next to skip what he has seen");
  await window.click("[data-review-confirm]");
  await window.waitForFunction(() => document.querySelector("[data-system-review-callout]") === null, null, { timeout: 60_000 });
  // The app capture shows Confirm's notice; here it would sit over the next shots until it clears.
  if ((await window.$("[data-toast-close]")) !== null) await window.click("[data-toast-close]");
  await window.click("[data-overview]:not([data-nav-systems])");

  const session = cli(["session", "new", "--title", "Meal plan", "--brief", BRIEF, "--project", project, "--system", system.id]).stdout.match(/\bs_[a-z0-9]+/)?.[0];
  if (session === undefined) throw new Error(`session new failed:\n${transcript.at(-1)}`);
  const work = join(home, "work");
  cli(["pull", session, "--out", work]);
  cpSync(join(demo, "slots"), join(work, "slots"), { recursive: true });
  cpSync(join(demo, "proposed"), join(work, "proposed"), { recursive: true });
  const wc = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  writeFileSync(join(work, "brainstorm.json"), `${JSON.stringify({ ...wc, slots: SLOTS }, null, 2)}\n`);

  // A first commit that drifts from the kit: a raw button with its own padding and radius, an inline margin, and
  // off-scale values in the proposed component's CSS. Commit refuses each one and names the kit's value.
  const recipe = join(work, "slots", "recipe", "card", "block.tsx");
  const strip = join(work, "slots", "week", "strip", "block.tsx");
  const css = join(work, "proposed", "WeekStrip", "component.css");
  const good = { recipe: readFileSync(recipe, "utf8"), strip: readFileSync(strip, "utf8"), css: readFileSync(css, "utf8") };
  writeFileSync(recipe, good.recipe.replace('<Button data-part="add">{primary}</Button>', '<button className="px-[13px] rounded-[7px] bg-primary" data-part="add">{primary}</button>'));
  writeFileSync(strip, good.strip.replace('<Card data-part="day">', '<Card data-part="day" style={{ marginTop: 13 }}>'));
  writeFileSync(css, good.css.replace("padding: calc(var(--spacing) * 2) 0;", "padding: 9px 0;").replace("border-radius: var(--radius);", "border-radius: 11px;"));
  cli(["commit", session, "--from", work, "--note", "First pass"]);
  writeFileSync(recipe, good.recipe);
  writeFileSync(strip, good.strip);
  writeFileSync(css, good.css);
  cli(["commit", session, "--from", work, "--note", "Two week layouts and a recipe card, all from the kit"]);
  // A freeform study has no kit to propose against, so it refuses proposed components outright.
  const sketch = cli(["session", "new", "--title", "Sketch", "--brief", "A loose sketch with no design system.", "--project", project]).stdout.match(/\bs_[a-z0-9]+/)?.[0];
  if (sketch === undefined) throw new Error(`session new failed:\n${transcript.at(-1)}`);
  const loose = join(home, "sketch");
  cli(["pull", sketch, "--out", loose]);
  cpSync(join(demo, "proposed"), join(loose, "proposed"), { recursive: true });
  cli(["commit", sketch, "--from", loose, "--note", "Borrow the week strip"]);
  await textShot(
    app,
    "agent-cli",
    "What the agent sees: adding robnet's UI library, starting a study with it, a commit refused for drifting from the kit, the fixed commit, and a freeform study refusing a proposed component",
    transcript.join("\n\n"),
    "The agent's terminal: system add syncs robnet's packages/ui (72 components, 73 stories, with warnings for stories that read no colour token and the kit's own off-scale values); session new --system; a commit refused for a raw <button> with className, an inline style, and literal padding and radius in the proposed component's CSS, each naming the kit token to write instead so theme tweaks reach it; then the clean commit; last, a freeform session (no --system) refuses a proposed/ folder with invalid_proposed",
  );

  // Rob looks at the library in the app.
  await window.click("[data-nav-systems]");
  await window.waitForSelector(`[data-system="${system.id}"]`);
  await shot(window, "systems-list", "The Design systems page: robnet's UI library as a card with its version, component and story counts, and Sync; the add-a-library field above");
  await window.click(`[data-system="${system.id}"]`);
  await window.waitForSelector('[data-gallery="true"]', { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2500));
  await shot(window, "system-gallery", "A design system's Components tab: the searchable catalog down the left, every story rendered live from the synced kit in the gallery, the theme axes (data-theme, data-accent) above it");
  await window.click('[data-entry="Card"]');
  await window.waitForSelector("[data-workbench]");
  await window.frameLocator('iframe[title="Stories"]').locator("[data-story-focused]").waitFor({ timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(window, "system-gallery-card", "Picking Card, which has one story: it opens straight in the workbench, the story at full width with its Controls, Props and Usage beside it, and the catalog nests Card's story under it");
  await window.click("[data-workbench-back]");
  await window.locator("[data-catalog]").getByText("All stories").click();
  await window.fill("[data-catalog-search]", "st");
  await window.waitForSelector('[data-entry="Stack"]');
  await new Promise((r) => setTimeout(r, 1500));
  await shot(window, "system-catalog-search", "The catalog filtered by 'st': names that start with it first, so Stack, the layout primitive Brainstorm generated because the library has none and marked as Brainstorm's, leads; the gallery narrows to the matches, Stack's frame showing Brainstorm's example of it");
  await window.fill("[data-catalog-search]", "");
  // The same story Storybook's controls exemplar shows: robnet's Button, Default, retitled at a phone width.
  await window.click('[data-entry="Button"]');
  await window.click('[data-entry-story$="button.stories.tsx#Default"]');
  await window.waitForSelector("[data-workbench]");
  await window.fill('[data-control="children"] input', "Plan next week");
  await window.click('[data-workbench-width="390"]');
  const libraryGallery = window.frameLocator('iframe[title="Stories"]');
  await libraryGallery.locator("[data-story-focused]", { hasText: "Plan next week" }).waitFor({ timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 600));
  await shot(window, "system-workbench", "robnet's Button › Default in the workbench, retitled 'Plan next week' at 390px: Controls from its args and props, Props with each prop's type, choices and default as the library's source declares them, and Usage that follows");
  await window.click("[data-workbench-back]");
  await window.click('[data-system-tab="theme"]');
  await window.waitForSelector("[data-system-theme]");
  await shot(window, "system-theme", "The Theme tab: the library's theme axes and its tokens with their values per axis");
  await window.click('[data-system-tab="warnings"]');
  await window.waitForSelector("[data-system-warnings]");
  await shot(window, "system-warnings", "The Warnings tab: what the sync noticed but didn't refuse: stories with no colour token, components with no story, values the kit itself writes off its scales");

  // The study, built from the kit.
  const canvas = await (async () => {
    await window.click(`[data-session="${session}"]`);
    await window.waitForSelector('[data-sidebar-panel="session"]');
    return canvasFrame(window);
  })();
  await canvas.waitForSelector('div[data-bid="week/list"] [data-part="week"]', { timeout: 60_000 });
  await shot(window, "session-stage", "The meal-plan brainstorm as it opens: the first block, built only from robnet's Card, Item, Badge, Progress and Button, on the stage; the Inspector's controls and, below them, the Design system section");
  await window.click('[data-view-option="board"]');
  await canvas.waitForSelector('#canvas[data-view="board"]');
  await window.click('[data-slot-id="week"] [data-variant="strip"]');
  await canvas.waitForSelector('div[data-bid="week/strip"] [data-part="strip"]', { timeout: 60_000 });
  await canvas.waitForSelector('div[data-bid="recipe/card"] [data-part="recipe"]', { timeout: 60_000 });
  await settled(() => canvas.$$eval("[data-bid]", (els) => els.map((e) => e.getBoundingClientRect().height)));
  await shot(window, "session-board", "All slots on the board, each showing its picked variant: the week slot on its 'strip' variant (the sidebar lists its 'list' variant too) and the recipe card, all composed from the kit; the WeekStrip the kit lacked carries a 'not in system' tag");
  const stripBlock = await canvas.$('div[data-bid="week/strip"] > *');
  await shot(window, "proposed-tag", "Close-up of the week-strip block: the proposed WeekStrip outlined with its 'WeekStrip · not in system' tag, beside kit components", {
    element: stripBlock,
  });

  // Rob tweaks the theme for this brainstorm.
  await window.locator("[data-system-panel]").scrollIntoViewIfNeeded();
  await shot(window, "inspector-system", "The Inspector's Design system section: robnet's UI at v1, the theme axes, colour and size tokens, Save as theme, Export theme and Reset, and the proposed WeekStrip with Promote");
  await window.click('[data-theme-axis="data-theme"] [data-axis-value="dark"]');
  await window.click('[data-theme-axis="data-accent"] [data-axis-select]');
  await window.click('[role="option"][data-axis-value="rose"]');
  await canvas.waitForFunction(() => document.documentElement.getAttribute("data-accent") === "rose");
  // The token lists start folded; open the sizes, set the radius, and fold them again, which keeps the tweak in view.
  const sizes = '[data-token-list="Sizes and type"] [data-slot="collapsible-trigger"]';
  await window.click(sizes);
  const radius = window.locator('[data-token="--radius"] input');
  await radius.fill("1rem");
  await radius.press("Enter");
  await window.waitForSelector('[data-token="--radius"][data-token-set]');
  await window.click(sizes);
  await window.locator("[data-theme-editor]").scrollIntoViewIfNeeded();
  await new Promise((r) => setTimeout(r, 800));
  await shot(window, "theme-tweaked", "The same brainstorm after three theme tweaks (dark, rose accent, 1rem radius): every block on the canvas follows, since they all read the kit's tokens, and the Inspector counts the tweaks");
  await window.click("[data-theme-save]");
  await window.keyboard.type("Rose night");
  await shot(window, "theme-save", "Saving the tweaks as a named theme of the design system, so another brainstorm can apply it");
  await window.click("[data-theme-save-confirm]");
  await window.waitForSelector("[data-theme-saved]");
  await window.click("[data-theme-export]");
  await window.waitForSelector("[data-theme-exported]", { timeout: 30_000 });
  await shot(window, "theme-export", "Exporting the session's theme: a CSS file of the overrides and a DTCG tokens file, with the path and Show in folder");
  await window.keyboard.press("Escape");
  // The Export button keeps focus after the popover closes, and its focus tooltip would cover the next shots.
  await new Promise((r) => setTimeout(r, 400));
  await window.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await window.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));

  // Rob promotes the proposed component into the library.
  await window.locator("[data-proposed-list]").scrollIntoViewIfNeeded();
  await window.click('[data-promote="WeekStrip"]');
  await window.waitForSelector('[data-proposed="WeekStrip"][data-promotion="started"]', { timeout: 30_000 });
  await window.locator("[data-proposed-list]").scrollIntoViewIfNeeded();
  const started = t3.started().at(-1);
  t3.startRun(started.thread);
  t3.reply(started.thread, "Moved WeekStrip into **components/ui/week-strip.tsx** and wrote its story. Running the library's check.");
  await window.waitForSelector('[data-promote-status] [data-agent-last-line]', { timeout: 30_000 });
  // A few seconds in, so the row shows how long the agent has worked.
  await new Promise((r) => setTimeout(r, 2500));
  await window.locator("[data-proposed-list]").scrollIntoViewIfNeeded();
  await shot(window, "promote-started", "After Promote: the WeekStrip row says the agent is adding it to robnet, with how long it has worked, its latest line and Open thread, and offers no second Promote while it runs");
  await textShot(
    app,
    "promote-message",
    `The thread Promote started in project "${started?.project}": its first message`,
    started?.message ?? "(no thread started)",
    "The first message of the T3 thread Promote started on the library's project: which component, from which brainstorm, the library's folder and entry, its proposed files, and the example props for its story",
  );

  // The promote thread added WeekStrip to the library and synced; the open brainstorm offers the upgrade.
  for (const [p, text] of Object.entries(promoted)) {
    mkdirSync(join(library, p, ".."), { recursive: true });
    writeFileSync(join(library, p), text);
  }
  writeFileSync(indexPath, `${indexBefore.trimEnd()}\nexport * from './components/ui/week-strip';\n`);
  t3.reply(started.thread, "It keeps the proposed look, written with the library's own variants.\n\nAdded WeekStrip to @robnet/ui as a primitive, with a story; the sync made v2.");
  t3.endRun(started.thread, "completed");
  cli(["system", "sync", system.id], { quiet: true });
  await window.waitForSelector("[data-system-upgrade]", { timeout: 30_000 });
  await window.locator("[data-system-panel]").scrollIntoViewIfNeeded();
  await shot(window, "upgrade-offered", "Once the library is synced with WeekStrip, the open brainstorm offers version 2: Upgrade checks every block against it first");
  await window.click("[data-system-upgrade]");
  await window.waitForSelector('[data-system-version="2"]', { timeout: 60_000 });
  await window.locator("[data-proposed-list]").scrollIntoViewIfNeeded();
  // The kit's WeekStrip replaces the proposed one in place: the block re-renders untagged.
  await canvas.waitForFunction(() => document.querySelector('div[data-bid="week/strip"] .bs-proposed-tag') === null, null, { timeout: 30_000 });
  await window.waitForSelector('[data-proposed="WeekStrip"][data-from-kit]');
  await shot(window, "upgraded", "After Upgrade: the brainstorm builds with v2 and keeps its theme tweaks; the week strip now renders the library's own WeekStrip, untagged, and the Inspector lists WeekStrip under Now in the kit");
  await window.click("[data-back]");
  await window.click("[data-nav-systems]");
  await window.click(`[data-system="${system.id}"]`);
  await window.click('[data-system-tab="versions"]');
  await window.waitForSelector("[data-system-versions]");
  await shot(window, "system-versions", "The Versions tab: v1 and v2, each with when it was synced, what it holds, and the brainstorms that build with it");
} finally {
  restoreLibrary();
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify({ shots: manifest, errors }, null, 2)}\n`);
  await app.close();
}
console.log(`${manifest.length} shots in ${out}`);
if (errors.length > 0) console.log(`window errors:\n${errors.join("\n")}`);
