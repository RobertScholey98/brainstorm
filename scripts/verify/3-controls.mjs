import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, showBoard, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-3");
const { check, finish } = checks();

const slider = '[data-control="spinSeconds"] input[type="range"]';
const hex = '[data-control="accent"] input[type="text"]';

async function neonState(window, canvas) {
  return {
    panel: { spinSeconds: await window.getAttribute(slider, "aria-valuenow"), accent: await window.inputValue(hex) },
    canvas: await canvas.evaluate(
      ([rotor, screen]) => ({
        transition: document.querySelector(rotor)?.style.transition,
        accent: document.querySelector(screen)?.style.getPropertyValue("--accent"),
      }),
      [inBlock("wheel/neon", "wheel-rotor"), inBlock("wheel/neon", "screen")],
    ),
  };
}

async function openNeon(window, session) {
  const canvas = await openSession(window, session);
  await showBoard(window, canvas);
  await canvas.waitForSelector(inBlock("wheel/neon", "screen"));
  await canvas.click(inBlock("wheel/neon", "chore"));
  await window.waitForSelector('[data-block="wheel/neon"]');
  return canvas;
}

let run = await launch(home, env);
const { session, work } = seedDemo(home, env);
try {
  await run.window.setViewportSize({ width: 1440, height: 900 });
  let canvas = await openNeon(run.window, session);
  check("the neon wheel starts at its defaults", await neonState(run.window, canvas), {
    panel: { spinSeconds: "2.4", accent: "#ff2bd6" },
    canvas: { transition: "transform 2.4s cubic-bezier(0.12, 0.7, 0.14, 1)", accent: "#ff2bd6" },
  });

  await run.window.focus(slider);
  for (let i = 0; i < 10; i++) await run.window.keyboard.press("ArrowRight");
  check(
    "a slider moved from the keyboard rings its thumb 2 px out from its edge",
    await run.window
      .waitForFunction(() => /0px 0px 0px 2px.*0px 0px 0px 4px/.test(getComputedStyle(document.querySelector('[data-control="spinSeconds"] [data-slot="slider-thumb"]')).boxShadow), null, { timeout: 2000 })
      .then(() => true, () => false),
    true,
  );
  await run.window.click(hex);
  check(
    "a focused text field takes a 1 px ring outside its ring-coloured edge, not a 2 px one",
    await run.window.$eval('[data-control="accent"] div:has(> input)', (el) => getComputedStyle(el).boxShadow.match(/0px 0px 0px [1-9]px/g)),
    ["0px 0px 0px 1px"],
  );
  await run.window.keyboard.press("Control+A");
  await run.window.keyboard.type("#00f0ff");
  await run.window.keyboard.press("Enter");
  await run.window.waitForSelector('[data-control="spinSeconds"][data-overridden]');
  await run.window.waitForSelector('[data-control="accent"][data-overridden]');
  check(
    "each overridden row puts its reset last, at one x, and its dot 6 px off the pane edge",
    await run.window.evaluate(() => {
      const aside = document.querySelector("aside[aria-label=Inspector]");
      const pane = { left: aside.getBoundingClientRect().left + aside.clientLeft };
      const rows = [...document.querySelectorAll("[data-control][data-overridden]")];
      return {
        resets: new Set(rows.map((r) => Math.round(r.querySelector("[data-control-reset]").getBoundingClientRect().right))).size,
        dots: rows.map((r) => Math.round(r.querySelector("[data-overridden-mark]").getBoundingClientRect().left - pane.left)),
      };
    }),
    { resets: 1, dots: [6, 6] },
  );
  const adjusted = {
    panel: { spinSeconds: "3.4", accent: "#00f0ff" },
    canvas: { transition: "transform 3.4s cubic-bezier(0.12, 0.7, 0.14, 1)", accent: "#00f0ff" },
  };
  check("the slider and colour repaint the canvas", await neonState(run.window, canvas), adjusted);
  await shot(run.window, shots, "1-adjusted");
  check("the window logged no errors or warnings", run.errors, []);

  await run.app.close();
  run = await launch(home, env);
  await run.window.setViewportSize({ width: 1440, height: 900 });
  canvas = await openNeon(run.window, session);
  check("both values survive a restart, in the panel and the canvas", await neonState(run.window, canvas), adjusted);
  await shot(run.window, shots, "2-restarted");

  const neon = (file) => join(work, "slots", "wheel", "neon", file);
  const edit = (file, from, to) => {
    const text = readFileSync(neon(file), "utf8");
    if (!text.includes(from)) throw new Error(`${file} no longer contains ${JSON.stringify(from)}`);
    writeFileSync(neon(file), text.replace(from, to));
  };

  edit("block.tsx", "Odds lean towards whoever has done least.", "Whoever has done least is likeliest to land.");
  const kept = brainstorm(env, ["commit", session, "--from", work, "--note", "Reword the odds line", "--json"]);
  check("the agent commits a reworded neon wheel", [kept.code, kept.json?.data?.iteration?.changed], [0, ["wheel/neon"]]);
  await canvas.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("likeliest"), inBlock("wheel/neon", "pool"));
  check("a regenerate that keeps both props keeps both values", await neonState(run.window, canvas), adjusted);
  await shot(run.window, shots, "3-regenerated");

  edit("block.tsx", "spinSeconds, accent, glow,", "spinSeconds, glow,");
  edit("block.tsx", 'const theme = PALETTES[palette] ?? PALETTES["Night city"];', 'const accent = "#ff2bd6";\n  const theme = PALETTES[palette] ?? PALETTES["Night city"];');
  edit("block.json", '      "accent": { "type": "color", "label": "Accent", "default": "#ff2bd6" },\n', "");
  const dropped = brainstorm(env, ["commit", session, "--from", work, "--note", "Fix the accent to the brand pink"]);
  check(
    "the agent's commit that drops accent warns override_dropped",
    [dropped.code, dropped.stdout.split("\n").filter((l) => l.includes("override_dropped"))],
    [0, ['slots/wheel/neon/block.json: warning override_dropped: Rob set accent = "#00f0ff" on wheel/neon, and it no longer applies (prop_removed); he\'ll see it flagged']],
  );
  await run.window.waitForSelector('[data-banner="inapplicable"] [data-override="wheel/neon:accent"]');
  check(
    "the banner names the dropped override and why",
    (await run.window.innerText('[data-override="wheel/neon:accent"]'))?.replace(/\s+/g, " ").trim(),
    "accent = #00F0FF On Neon wheel: the block no longer has this setting. Dismiss",
  );
  check("the slider's value still applies", await run.window.getAttribute(slider, "aria-valuenow"), "3.4");
  check("the panel no longer has an accent control", await run.window.isVisible(hex), false);
  await shot(run.window, shots, "4-dropped");

  await run.window.click('[data-override="wheel/neon:accent"] button');
  await run.window.waitForSelector('[data-banner="inapplicable"]', { state: "detached" });
  check("Dismiss clears the banner", await run.window.isVisible('[data-banner="inapplicable"]'), false);
  check("the window logged no errors or warnings after the restart", run.errors, []);
} finally {
  await run.app.close();
}
finish();
