import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, settled, showBoard, shot, workspace } from "./electron.mjs";

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

  const valueRight = () => run.window.$eval('[data-control="spinSeconds"] [data-value]', (el) => Math.round(el.getBoundingClientRect().right));
  const valueAt = [await valueRight()];
  check(
    "at rest a slider's value ends on the column's right edge, with every other control",
    await run.window.$eval('[data-control="spinSeconds"]', (row) => Math.round(row.getBoundingClientRect().right - row.querySelector("[data-value]").getBoundingClientRect().right)),
    0,
  );
  check(
    "a switch row stands 22 px off the rows round it, the 16 px gap and the 6 px a slider's track keeps a side",
    await run.window.$eval("[data-control]:has([role=switch])", (row) => {
      const line = row.firstElementChild.getBoundingClientRect();
      return [Math.round(line.top - row.previousElementSibling.getBoundingClientRect().bottom), Math.round(row.nextElementSibling.getBoundingClientRect().top - line.bottom)];
    }),
    [22, 22],
  );
  for (const theme of ["light", "dark"]) {
    await run.window.emulateMedia({ colorScheme: theme });
    check(
      `in ${theme}, a slider's unfilled track takes the strong edge every other control draws, and its filled run stands off it`,
      await run.window.$eval('[data-control="spinSeconds"]', (row) => {
        const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "background: var(--border-strong)" }));
        const strong = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const [track, range] = [row.querySelector("[data-slot=slider-track]"), row.querySelector("[data-slot=slider-range]")].map((el) => getComputedStyle(el).backgroundColor);
        return [track === strong, range !== track];
      }),
      [true, true],
    );
  }
  await run.window.emulateMedia({ colorScheme: "light" });
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
    "a focused text field turns its 1 px edge the ring tone and adds no ring, so it is no heavier than the edges round it",
    // Read once its colour transition has finished.
    await settled(() =>
      run.window.$eval('[data-control="accent"] div:has(> input)', (el) => {
        const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--ring)" }));
        const ring = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(el);
        const rest = getComputedStyle(document.querySelector('[data-slot="select-trigger"]')).borderTopWidth;
        return [style.borderTopWidth === rest, style.borderTopColor === ring, /0px 0px 0px [1-9]/.test(style.boxShadow)];
      }),
    ),
    [true, true, false],
  );
  await run.window.click('[data-slot="select-trigger"]');
  await run.window.waitForSelector('[data-slot="select-trigger"][data-popup-open]');
  check(
    "an open select's trigger takes the open look of every other popover trigger: the accent edge on the selected fill",
    await settled(() =>
      run.window.$eval('[data-slot="select-trigger"]', (el) => {
        const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "border: 1px solid var(--accent); background: var(--selected)" }));
        const want = getComputedStyle(probe);
        const [edge, fill] = [want.borderTopColor, want.backgroundColor];
        probe.remove();
        const style = getComputedStyle(el);
        return [style.borderTopColor === edge, style.backgroundColor === fill];
      }),
    ),
    [true, true],
  );
  check(
    "its options are 28 px rows, the height of the trigger and every control beside it",
    await settled(() => run.window.$$eval("[data-slot=select-item]", (rows) => [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))])),
    [28],
  );
  await run.window.keyboard.press("Escape");
  await run.window.waitForSelector('[data-slot="select-trigger"]:not([data-popup-open])');
  await run.window.click(hex);
  await run.window.keyboard.press("Control+A");
  await run.window.keyboard.type("#00f0ff");
  await run.window.keyboard.press("Enter");
  await run.window.waitForSelector('[data-control="spinSeconds"][data-overridden]');
  await run.window.waitForSelector('[data-control="accent"][data-overridden]');
  valueAt.push(await valueRight());
  check("a slider's value keeps its right edge once it is overridden", new Set(valueAt).size, 1);
  check(
    "each overridden row opens its reset just before the row's end, its last ink on the column edge, a value's or the reset glyph's, and its dot 6 px off the pane edge",
    await run.window.evaluate(() => {
      const aside = document.querySelector("aside[aria-label=Inspector]");
      const pane = { left: aside.getBoundingClientRect().left + aside.clientLeft };
      const rows = [...document.querySelectorAll("[data-control][data-overridden]")];
      // A glyph's ink is its paths' box and half their stroke, scaled from the view box; a value's is its text's.
      const ink = (el) => {
        const svg = el.matches("svg") ? el : el.querySelector("svg");
        if (svg === null) {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().right;
        }
        const box = svg.getBBox();
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        return svg.getBoundingClientRect().left + (box.x + box.width + parseFloat(getComputedStyle(svg).strokeWidth) / 2) * scale;
      };
      return {
        ends: rows.map((r) => {
          const line = r.firstElementChild.getBoundingClientRect();
          const end = r.firstElementChild.lastElementChild.lastElementChild;
          return [Math.abs(line.right - ink(end)) <= 1, r.querySelector("[data-control-reset]").getBoundingClientRect().right <= end.getBoundingClientRect().right];
        }),
        dots: rows.map((r) => Math.round(r.querySelector("[data-overridden-mark]").getBoundingClientRect().left - pane.left)),
      };
    }),
    { ends: [[true, true], [true, true]], dots: [6, 6] },
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
    "the banner names the dropped setting, as words, and why, without naming the block the header names, at its sentence's weight",
    [
      (await run.window.innerText('[data-override="wheel/neon:accent"]'))?.replace(/\s+/g, " ").trim(),
      await run.window.$eval('[data-override="wheel/neon:accent"] span', (s) => getComputedStyle(s).fontWeight),
    ],
    ["Accent: #00F0FF The block no longer has this setting. Dismiss", "400"],
  );
  check(
    "its heading says what became of the value, kept but not applied, so it doesn't repeat the item's reason",
    (await run.window.textContent('[data-banner="inapplicable"] p[data-callout-tone]'))?.trim(),
    "A setting is kept but not applied",
  );
  check(
    "the banner's Dismiss is the 28 px control height of every button beside it",
    await run.window.$eval('[data-override="wheel/neon:accent"] button', (b) => b.getBoundingClientRect().height),
    28,
  );
  for (const theme of ["light", "dark"]) {
    await run.window.emulateMedia({ colorScheme: theme });
    await run.window.mouse.move(700, 10);
    await run.window.waitForTimeout(250);
    check(
      `in ${theme}, the banner's Dismiss drops the card fill on the callout's tint, so its edge alone draws it, as on a selected comment`,
      await run.window.$$eval("[data-slot=callout] [data-slot=button]", (buttons) =>
        buttons.filter((b) => getComputedStyle(b).borderTopColor !== "rgba(0, 0, 0, 0)").map((b) => [b.textContent.trim(), getComputedStyle(b).backgroundColor]),
      ),
      [["Dismiss", "rgba(0, 0, 0, 0)"]],
    );
  }
  await run.window.emulateMedia({ colorScheme: "light" });
  check("the slider's value still applies", await run.window.getAttribute(slider, "aria-valuenow"), "3.4");
  check("the panel no longer has an accent control", await run.window.isVisible(hex), false);
  await shot(run.window, shots, "4-dropped");

  await run.window.click('[data-override="wheel/neon:accent"] button');
  await run.window.waitForSelector('[data-banner="inapplicable"]', { state: "detached" });
  check("Dismiss clears the banner", await run.window.isVisible('[data-banner="inapplicable"]'), false);
  check("the window logged no errors or warnings after the restart", run.errors, []);

  // The commit renders each block before it saves, so the wheel breaks only once it is on the canvas.
  edit(
    "block.tsx",
    'const theme = PALETTES[palette] ?? PALETTES["Night city"];',
    'useEffect(() => {\n    throw new Error("The wheel lost its spokes");\n  }, []);\n  const theme = PALETTES[palette] ?? PALETTES["Night city"];',
  );
  const broken = brainstorm(env, ["commit", session, "--from", work, "--note", "Break the wheel"]);
  check("the agent commits a wheel that breaks once it mounts", broken.code, 0);
  await run.window.waitForSelector('[data-block="wheel/neon"] [role="alert"]');
  const off = [await run.window.isDisabled("[data-vary-toggle]"), await run.window.isDisabled("[data-pick-toggle]")];
  const hoverHint = async (trigger) => {
    await run.window.mouse.move(120, 600);
    await run.window.waitForSelector('[data-slot="tooltip-content"]', { state: "detached" });
    await run.window.hover(trigger);
    return run.window.waitForSelector('[data-slot="tooltip-content"]', { timeout: 3000 }).then((h) => h.textContent()).then((t) => t.trim(), () => null);
  };
  check(
    "a block that didn't render leaves Vary element and Pin comment off, and each hint opens under the pointer saying why",
    [...off, await hoverHint("[data-vary-blocked]"), await hoverHint("[data-pick-blocked]")],
    [true, true, "The block didn't render, so there's nothing to pick", "The block didn't render, so there's nothing to pick"],
  );
} finally {
  await run.app.close();
}
finish();
