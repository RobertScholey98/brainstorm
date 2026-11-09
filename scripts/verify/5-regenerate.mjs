import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, settled, showBoard, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-5");
const { check, finish } = checks();
const t3 = fakeT3(env.BRAINSTORM_FAKE_T3_STATE);
const TAKEOVER = "33333333-3333-4333-8333-333333333333";
const PHASE_MS = 15_000;

const { app, window, errors } = await launch(home, env);

async function phase(name) {
  await window.waitForSelector(`[data-request-phase="${name}"]`, { timeout: PHASE_MS });
  const clipped = await window.$eval("[data-request-message]", (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
  check(`${name}: the whole message is readable`, clipped, false);
  check(
    `${name}: the bar's label takes its icon's tone`,
    await window.$eval("[data-topbar] [data-request-phase]", (el) => {
      const label = el.querySelector("[data-request-label], [data-request-message]");
      const icon = el.firstElementChild;
      const ink = icon.tagName === "svg" ? getComputedStyle(icon).color : getComputedStyle(icon.querySelector("[data-phase-glyph] > span")).backgroundColor;
      return getComputedStyle(label).color === ink;
    }),
    true,
  );
  return {
    message: (await window.textContent("[data-request-message]"))?.trim(),
    actions: await window.$$eval("[data-phase-actions] [data-request-action]", (els) => els.map((e) => e.dataset.requestAction)),
  };
}

/** The header controls, and the request status, a hint covers once it has settled in place, by their labels. */
async function coveredBy(trigger) {
  // A trigger still moving after a resize slides out from under the pointer, and its hint closes, so it is hovered once
  // it is still. Right after a popover closes, the first entry sometimes opens no hint, so a miss re-enters.
  await settled(() => window.$eval(trigger, (el) => JSON.stringify(el.getBoundingClientRect())));
  for (let attempt = 0; ; attempt += 1) {
    await window.mouse.move(120, 600);
    await window.waitForSelector('[data-slot="tooltip-content"]', { state: "detached" });
    await window.hover(trigger);
    const shown = await window.waitForSelector('[data-slot="tooltip-content"]', { state: "visible", timeout: 3000 }).catch(() => null);
    if (shown !== null) break;
    if (attempt === 2) return "the hint never opened";
  }
  const covered = await settled(() =>
    window.evaluate(() => {
      const shown = document.querySelector('[data-slot="tooltip-content"]');
      if (shown === null) return "the hint closed";
      const hint = shown.getBoundingClientRect();
      const over = (r) => hint.left < r.right && hint.right > r.left && hint.top < r.bottom && hint.bottom > r.top;
      return [...document.querySelectorAll('[data-topbar] :is(button, a, [tabindex="0"], [data-request-phase], [data-thread-lost])')]
        .filter((c) => c.getClientRects().length > 0 && over(c.getBoundingClientRect()))
        .map((c) => c.textContent.trim() || c.getAttribute("aria-label"));
    }),
  );
  await window.mouse.move(120, 600);
  return covered;
}

async function regenerate(scope, freetext) {
  await window.click("[data-regenerate-toggle]");
  await window.click(`[data-regenerate-menu] [data-scope="${scope}"]`);
  if (freetext !== undefined) await window.fill("[data-regenerate-menu] [data-freetext]", freetext);
}

const markers = (thread, n) => t3.messages(thread).filter((m) => m.text.includes(` · request ${n} · `)).length;

try {
  await app.evaluate(({ shell }) => {
    globalThis.opened = [];
    shell.openExternal = async (url) => void globalThis.opened.push(url);
  });
  await window.setViewportSize({ width: 1440, height: 900 });
  const { session } = seedDemo(home, env);
  const canvas = await openSession(window, session);
  await showBoard(window, canvas);
  await canvas.waitForSelector(inBlock("wheel/neon", "screen"));
  await canvas.waitForSelector(inBlock("result/card", "card"));
  await window.hover("[data-regenerate-toggle]");
  check(
    "at 1440 Regenerate's hint, with its name, words and key, is one 24 px line, nothing cut",
    await window
      .waitForSelector('[data-slot="tooltip-content"]', { state: "visible" })
      .then((h) => h.evaluate((el) => [Math.round(el.getBoundingClientRect().height), el.textContent.trim(), el.querySelector("[data-cut]") === null])),
    [24, "Regenerate·Ask the agent for a new iterationCtrl+R", true],
  );
  await window.mouse.move(120, 600);

  await canvas.click(inBlock("result/card", "chore"));
  await window.waitForSelector('[data-block="result/card"]');
  await window.click('[data-control="headline"] input');
  await window.keyboard.press("Control+A");
  await window.keyboard.type("Fate has spoken");
  await window.waitForSelector('[data-control="headline"][data-overridden]');
  await canvas.click(inBlock("result/card", "accept-button"));
  check("the card's own state flips to accepted", await canvas.textContent(inBlock("result/card", "accept-button")), "Accepted");

  await canvas.click(inBlock("wheel/neon", "logo"));
  await window.waitForSelector('[data-block="wheel/neon"]');
  await window.click('[data-control="accent"] input[type="text"]');
  await window.keyboard.press("Control+A");
  await window.keyboard.type("#00f0ff");
  await window.keyboard.press("Enter");
  await window.waitForSelector('[data-control="accent"][data-overridden]');

  await window.click("[data-pick-toggle]");
  await canvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-composer]");
  await window.keyboard.type("The spin feels rigged");
  await window.keyboard.press("Control+Enter");
  await window.waitForSelector('[data-feedback="1"][data-status="open"]');

  await canvas.evaluate(() => {
    for (const id of ["result/card", "wheel/neon"]) document.querySelector(`[data-bid="${id}"] [data-part="screen"]`).dataset.mounted = "before";
    window.receivedModules = [];
    addEventListener("message", (e) => e.data?.kind === "modules" && window.receivedModules.push(...e.data.modules.map((m) => m.blockId)));
  });

  await regenerate("blocks", "make the spin feel less random");
  check(
    "Regenerate leads with a glyph as Export does, and its popover's description takes its grammar, the brainstorm then a clause",
    [
      await window.$eval("[data-regenerate-toggle]", (b) => b.firstElementChild?.tagName.toLowerCase()),
      (await window.textContent("[data-regenerate-menu] [data-slot=popover-description]"))?.trim(),
    ],
    ["svg", "Chore roulette · a new iteration from the agent"],
  );
  check(
    "Selected blocks defaults to the selected block",
    await window.$$eval("[data-block-choices] input:checked", (els) => els.map((e) => e.closest("[data-choice]").dataset.choice)),
    ["wheel/neon"],
  );
  check(
    "the checklist keeps the column's edges: checkboxes start under the slot headings and tags end with the free text, so only the hover fill overhangs",
    await window.$eval("[data-regenerate-menu]", (menu) => {
      const field = menu.querySelector("[data-freetext]").getBoundingClientRect();
      const legend = menu.querySelector("[data-block-choices] legend").getBoundingClientRect();
      const row = menu.querySelector("[data-choice]");
      const box = row.querySelector("[data-slot=checkbox]").getBoundingClientRect();
      const tag = row.lastElementChild.getBoundingClientRect();
      return [Math.round(box.left - legend.left), Math.round(field.right - tag.right)].map((d) => d || 0);
    }),
    [0, 0],
  );
  check(
    "the menu lists the in-scope open feedback it will attach",
    await window.$$eval("[data-attached]", (els) => els.map((e) => e.dataset.attached)),
    ["1"],
  );
  check(
    "it marks the attached comment with the pin's own disc, as the feedback list does, not a number in accent text",
    await window.evaluate(() => {
      const look = (d) => d && [d.dataset.pinNumber, getComputedStyle(d).backgroundColor, getComputedStyle(d).borderBottomLeftRadius, Math.round(d.getBoundingClientRect().height)];
      const [attached, listed] = [document.querySelector('[data-attached="1"] [data-pin-number]'), document.querySelector('[data-feedback="1"] [data-pin-number]')].map(look);
      return [attached?.[0], JSON.stringify(attached) === JSON.stringify(listed)];
    }),
    ["open", true],
  );
  await shot(window, shots, "1-menu");
  const fieldTop = () => window.$eval("[data-regenerate-menu] [data-freetext]", (el) => Math.round(el.getBoundingClientRect().top));
  const tops = [await fieldTop()];
  for (const scope of ["all", "described", "blocks"]) {
    await window.click(`[data-regenerate-menu] [data-scope="${scope}"]`);
    tops.push(await fieldTop());
  }
  check("the free text stays under the scope switch, at one height in every scope", new Set(tops).size, 1);
  const sendLook = () =>
    window.$eval("[data-regenerate-menu] [data-slot=popover-footer]", (footer) => {
      const send = footer.querySelector("[data-send]");
      return [send.disabled, getComputedStyle(send).opacity, getComputedStyle(footer.querySelector("[data-slot=kbd]")).opacity];
    });
  check(
    "the footer's hint reads whole and stands at least 16 px off its Ctrl+Enter key, so the two never read as one phrase",
    await window.$eval("[data-regenerate-menu] [data-slot=popover-footer]", (footer) => {
      const hint = footer.firstElementChild;
      return [hint.scrollWidth <= hint.clientWidth, Math.round(footer.querySelector("[data-slot=kbd]").getBoundingClientRect().left - hint.getBoundingClientRect().right) >= 16];
    }),
    [true, true],
  );
  check(
    "the Ctrl+Enter key stands 4 px before Send, the button it presses, and 12 px after Cancel, so it never reads as Cancel's",
    await window.$eval("[data-regenerate-menu] [data-slot=popover-footer]", (footer) => {
      const box = (el) => el.getBoundingClientRect();
      const [key, send] = [box(footer.querySelector("[data-slot=kbd]")), box(footer.querySelector("[data-send]"))];
      const cancel = box([...footer.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel"));
      return [Math.round(send.left - key.right), Math.round(key.left - cancel.right)];
    }),
    [4, 12],
  );
  await window.click('[data-regenerate-menu] [data-scope="described"]');
  await window.fill("[data-regenerate-menu] [data-freetext]", "");
  check("a disabled Send dims its Ctrl+Enter chip with it", await settled(sendLook), [true, "0.5", "0.5"]);
  await window.fill("[data-regenerate-menu] [data-freetext]", "make the spin feel less random");
  await window.click('[data-regenerate-menu] [data-scope="blocks"]');
  check("and an enabled one shows it whole", await settled(sendLook), [false, "1", "1"]);
  await window.click("[data-regenerate-menu] [data-send]");
  check("the queued request shows with its actions", await phase("queued"), { message: "Queued in T3", actions: ["open_thread", "withdraw"] });
  check(
    "the fake T3 received exactly the [brainstorm] message",
    t3.sent().map((s) => s.message),
    [
      `[brainstorm] session ${session} · request 1 · scope: wheel/neon · feedback: #1 · freetext: "make the spin feel less random"\nHandle with the use-brainstorm skill: run \`brainstorm context ${session}\`.`,
    ],
  );
  check("Regenerate is disabled while the request is open", await window.isDisabled("[data-regenerate-toggle]"), true);
  await shot(window, shots, "2-queued");

  t3.startRun(DEMO_THREAD);
  check("the agent picking it up shows as working", await phase("working"), { message: "Agent working", actions: ["open_thread", "withdraw"] });
  check(
    "working's live dot sits in a 14 px halo, the optical size of the other phases' glyphs",
    await window.$eval("[data-request-phase=working] [data-phase-glyph]", (g) => Math.round(g.getBoundingClientRect().width)),
    14,
  );
  await window.setViewportSize({ width: 1100, height: 720 });
  check(
    "at 1100 with a request open Open thread gives up its label for its icon and Withdraw keeps its name, since a lone Withdraw glyph would read as the withdrawn status, so the title keeps 160 px or reads whole, and the status message reads whole",
    await settled(() =>
      window.evaluate(() => {
        const [title, message] = [document.querySelector("[data-session-title]"), document.querySelector("[data-request-message]")];
        return [
          [...document.querySelectorAll("[data-phase-actions] [data-request-action]")].map((a) => Math.round(a.getBoundingClientRect().width)),
          title.scrollWidth <= title.clientWidth || title.clientWidth >= 160,
          message.scrollWidth <= message.clientWidth,
        ];
      }),
    ),
    [[28, 93], true, true],
  );
  check(
    "in the narrowest window, 1100, the title and message give way, and the phase actions stay clear of Regenerate",
    await window.evaluate(() => {
      const last = [...document.querySelectorAll("[data-phase-actions] [data-request-action]")].at(-1).getBoundingClientRect();
      return last.right <= document.querySelector("[data-regenerate-toggle]").getBoundingClientRect().left;
    }),
    true,
  );
  await window.setViewportSize({ width: 1440, height: 900 });

  const context = brainstorm(env, ["context", session, "--json"]).json?.data;
  check(
    "the agent's context carries the request",
    { n: context?.request?.n, scope: context?.request?.scope, freetext: context?.request?.freetext, feedback: context?.request?.feedback.map((f) => f.id) },
    { n: 1, scope: { kind: "blocks", blocks: ["wheel/neon"] }, freetext: "make the spin feel less random", feedback: [1] },
  );
  const agentCopy = join(home, "agent-copy");
  check("the agent pulls a working copy", brainstorm(env, ["pull", session, "--out", agentCopy, "--json"]).code, 0);
  const neonTsx = join(agentCopy, "slots", "wheel", "neon", "block.tsx");
  const source = readFileSync(neonTsx, "utf8");
  if (!source.includes("Odds lean towards whoever has done least.")) throw new Error("the neon wheel no longer has the expected odds line");
  writeFileSync(neonTsx, source.replace("Odds lean towards whoever has done least.", "Every spin is weighted by chores done."));
  const committed = brainstorm(env, ["commit", session, "--from", agentCopy, "--addresses", "1", "--note", "Explain the weighting", "--json"]);
  check(
    "the agent commits only the block in scope, with no warnings",
    [committed.code, committed.json?.data?.iteration?.changed, committed.json?.data?.warnings],
    [0, ["wheel/neon"], []],
  );
  t3.endRun(DEMO_THREAD, "completed");

  check("the fulfilled request names what changed", await phase("fulfilled"), { message: "Iteration 2 · changed Neon wheel", actions: [] });
  await canvas.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("weighted by chores"), inBlock("wheel/neon", "pool"));
  check("the host sent only the changed block's module", await canvas.evaluate(() => window.receivedModules), ["wheel/neon"]);
  check(
    "the changed block remounted and the other kept its mounted element",
    await canvas.evaluate(() => ["wheel/neon", "result/card"].map((id) => document.querySelector(`[data-bid="${id}"] [data-part="screen"]`).dataset.mounted ?? null)),
    [null, "before"],
  );
  check("the unchanged card kept its component state", await canvas.textContent(inBlock("result/card", "accept-button")), "Accepted");
  check(
    "both overrides persisted through the regenerate",
    await canvas.evaluate(
      ([headline, screen]) => [document.querySelector(headline).textContent.trim(), document.querySelector(screen).style.getPropertyValue("--accent")],
      [inBlock("result/card", "headline"), inBlock("wheel/neon", "screen")],
    ),
    ["Fate has spoken", "#00f0ff"],
  );
  await window.waitForSelector('[data-feedback="1"][data-status="addressed"]');
  check(
    "the feedback it addressed is ready to confirm",
    (await window.textContent('[data-feedback="1"] [data-feedback-status]'))?.trim(),
    "In iteration 2",
  );
  check("Regenerate is enabled again", await window.isDisabled("[data-regenerate-toggle]"), false);
  await shot(window, shots, "3-fulfilled");

  await regenerate("all");
  await window.click("[data-regenerate-menu] [data-send]");
  check("queued", await phase("queued"), { message: "Queued in T3", actions: ["open_thread", "withdraw"] });
  const withdrawAt = () =>
    window.$$eval('[data-phase-actions] :is([data-request-action="open_thread"], [data-request-action="withdraw"])', (els) => {
      const regenerate = document.querySelector("[data-regenerate-toggle]").getBoundingClientRect().left;
      return [els.map((el) => Math.round(el.getBoundingClientRect().left)).join(), els.map((el) => Math.round(regenerate - el.getBoundingClientRect().left)).join()];
    });
  const at = [await withdrawAt()];
  check(
    "the request's actions sit in the header's right cluster, a divider in the separator tone between them and Regenerate",
    await window.evaluate(() => {
      const right = (s) => document.querySelector(s).getBoundingClientRect();
      return [
        right("[data-phase-actions]").right <= right("[data-phase-divider]").left,
        right("[data-phase-divider]").right <= right("[data-regenerate-toggle]").left,
        (() => {
          const probe = document.body.appendChild(Object.assign(document.createElement("div"), { style: "background-color: var(--separator)" }));
          const tone = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return getComputedStyle(document.querySelector("[data-phase-divider]")).backgroundColor === tone;
        })(),
      ];
    }),
    [true, true, true],
  );
  const headerHints = async () => {
    const covered = [];
    for (const trigger of ["[data-regenerate-blocked]", "[data-export]", "[data-inspector-toggle]"]) covered.push(await coveredBy(trigger));
    return covered;
  };
  check("no header hint covers a header control or the request status, the blocked Regenerate's least of all", await headerHints(), [[], [], []]);
  await window.hover("[data-regenerate-blocked]");
  check(
    "a hint is 24 px tall, under the 28 px controls beside it, so it never reads as one more button",
    await settled(() => window.$eval('[data-slot="tooltip-content"]', (h) => Math.round(h.getBoundingClientRect().height))),
    24,
  );
  const overText = () =>
    settled(() =>
      window.evaluate(() => {
        const hint = document.querySelector('[data-slot="tooltip-content"]').getBoundingClientRect();
        const crumb = document.querySelector("[data-topbar] nav").getBoundingClientRect();
        const end = Math.max(crumb.right, document.querySelector("[data-topbar] [data-iteration]").getBoundingClientRect().right);
        const row = document.querySelector("[data-header-thread], [data-header-status], [data-header-actions]").getBoundingClientRect();
        return {
          offRow: Math.round(row.left - hint.right) >= 8,
          badgeCovered: hint.right >= end - 0.5,
          text: hint.left >= end ? "clear" : Math.abs(hint.left - crumb.left) < 1 ? "covered from its start" : "cut",
          name: document.querySelector('[data-slot="tooltip-content"] [data-hint-name]')?.textContent,
        };
      }),
    );
  check(
    "the blocked Regenerate's hint leads with Regenerate, stands at least 8 px off the thread chip's divider, and covers the breadcrumb and badge from start to end, leaving no half-word or sliver",
    await overText(),
    { offRow: true, badgeCovered: true, text: "covered from its start", name: "Regenerate" },
  );
  await window.mouse.move(120, 600);
  await window.setViewportSize({ width: 1100, height: 720 });
  check("nor at 1100", await headerHints(), [[], [], []]);
  check(
    "at 1100 with a request open, Export gives up its label for its icon, so the title still reads whole",
    await settled(() =>
      window.evaluate(() => {
        const title = document.querySelector("[data-session-title]");
        return [
          ["[data-export]"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().width)),
          title.scrollWidth <= title.clientWidth,
        ];
      }),
    ),
    [[28], true],
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.click('[data-request-action="open_thread"]');
  await window.waitForTimeout(300);
  check("Open thread opens the thread's link outside the app", await app.evaluate(() => globalThis.opened), [`https://app.t3.codes/threads/fake/${DEMO_THREAD}`]);

  t3.startRun(DEMO_THREAD);
  check("working", await phase("working"), { message: "Agent working", actions: ["open_thread", "withdraw"] });
  check("working shows progress", await window.isVisible("[data-request-phase] [data-progress]"), true);
  check(
    "the top bar's thread chip names the thread and says it is busy with the pulsing mark home's rows use",
    await window.$eval('[data-thread-chip][data-thread="working"]', (el) => ({
      text: el.textContent.trim(),
      pulses: el.querySelector(".animate-ping") !== null,
    })),
    { text: "Chore roulette study", pulses: true },
  );
  at.push(await withdrawAt());
  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector(`[data-overview-session="${session}"] [data-session-status="working"]`, { timeout: PHASE_MS });
  await window.waitForFunction((id) => document.querySelector(`[data-overview-session="${id}"] [data-status-elapsed]`)?.textContent !== "", session);
  check(
    "home shows the request's phase on the brainstorm's row and card, in the accent while the agent works, and both count how long",
    await window.evaluate((id) => {
      const row = document.querySelector(`[data-session="${id}"] [data-session-status]`);
      const card = document.querySelector(`[data-overview-session="${id}"] [data-session-status]`);
      const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
      const probe = document.body.appendChild(Object.assign(document.createElement("i"), { style: `color: ${accent}` }));
      const tone = getComputedStyle(probe).color;
      probe.remove();
      return { row: row.textContent.trim().replace(/\d+/, "N"), card: card.textContent.trim().replace(/\d+/, "N"), tone: [row, card].every((el) => getComputedStyle(el).color === tone), pulses: row.querySelector(".animate-ping") !== null };
    }, session),
    { row: "Agent working Ns", card: "Agent working Ns", tone: true, pulses: true },
  );
  await openSession(window, session);
  await window.waitForSelector('[data-request-phase="working"]');
  t3.ask(DEMO_THREAD);
  check("asking", await phase("asking"), { message: "Agent asking in T3", actions: ["open_thread", "withdraw"] });
  check("asking shows no spinner", await window.$("[data-request-phase] [data-progress]"), null);
  at.push(await withdrawAt());
  await shot(window, shots, "4-asking");

  t3.endRun(DEMO_THREAD, "failed");
  check("run failed", await phase("run_failed"), {
    message: "The agent's run failed in T3. Open the thread to see why, or Retry.",
    actions: ["retry", "open_thread", "withdraw"],
  });
  at.push(await withdrawAt());
  const stripLines = () =>
    window.$eval("[data-request-detail] [data-request-message]", (p) => [p.closest("[data-request-detail]").querySelector("[data-request-action]") === null, Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight))]);
  const failedStrip = [await stripLines()];
  await window.setViewportSize({ width: 1100, height: 720 });
  failedStrip.push(await settled(stripLines));
  await window.setViewportSize({ width: 1440, height: 900 });
  check("run failed's strip carries only its text, on one line at 1440 and at 1100", failedStrip, [[true, 1], [true, 1]]);
  await shot(window, shots, "5-run-failed");
  const beforeRetry = t3.sent().length;
  await window.click('[data-request-action="retry"]');
  check("Retry after a failed run sends the request again", [await phase("queued"), t3.sent().length - beforeRetry], [{ message: "Queued in T3", actions: ["open_thread", "withdraw"] }, 1]);

  t3.startRun(DEMO_THREAD);
  await phase("working");
  t3.endRun(DEMO_THREAD, "completed");
  check("no change", await phase("no_change"), { message: "The agent replied in T3 without changing the design.", actions: ["retry", "open_thread", "withdraw"] });
  at.push(await withdrawAt());
  check(
    // Their x moves with what the fit takes from the header (the elapsed time and the thread chip come and go), so the
    // invariant is where they sit beside Regenerate.
    "Open thread and Withdraw keep their place beside Regenerate from queued through working, asking, run failed and no change",
    at.map(([, fromRegenerate]) => fromRegenerate),
    Array(at.length).fill(at[0][1]),
  );
  await window.click('[data-request-action="withdraw"]');
  check("Withdraw closes the request", await phase("withdrawn"), { message: "Request withdrawn", actions: [] });

  t3.setFailAfter(["send"]);
  await regenerate("described", "try a calmer palette everywhere");
  await window.click("[data-regenerate-menu] [data-send]");
  check("send failed", await phase("send_failed"), {
    message: "Couldn't send (fake t3 failure: the reply was lost). The request is saved.",
    actions: ["retry", "open_thread", "withdraw"],
  });
  await shot(window, shots, "6-send-failed");
  t3.setFailAfter([]);
  const sentBefore = t3.sent().length;
  await window.click('[data-request-action="retry"]');
  check("Retry finds the message already arrived", await phase("queued"), { message: "Queued in T3", actions: ["open_thread", "withdraw"] });
  check("and doesn't send it twice", [t3.sent().length - sentBefore, markers(DEMO_THREAD, 3)], [0, 1]);

  t3.addThread(TAKEOVER, { projectId: "chore-roulette", title: "Takeover thread" });
  const attached = brainstorm(env, ["session", "attach", "Chore roulette", "--thread", TAKEOVER, "--json"]);
  check("a new thread takes the session over through the CLI", [attached.code, attached.json?.data?.previous], [0, DEMO_THREAD]);
  check("previous thread", await phase("previous_thread"), { message: "Another thread took this brainstorm over. Resend sends the request to it.", actions: ["resend", "open_thread", "withdraw"] });
  // The pointer rests where Retry was, and Resend now stands there with its hint open.
  await window.mouse.move(1, 1);
  await window.waitForSelector("[data-slot=tooltip-content]", { state: "detached" });
  await window.hover('[data-request-action="open_thread"]');
  check(
    "after a takeover, Open thread's hint leads with its name, then names the thread it opens",
    await window
      .waitForSelector('[data-slot="tooltip-content"]', { state: "visible" })
      .then((h) => h.evaluate((el) => [el.querySelector("[data-hint-name]")?.textContent, el.lastElementChild.textContent])),
    ["Open thread", "Takeover thread, in T3"],
  );
  await window.mouse.move(120, 600);
  await shot(window, shots, "7-previous-thread");
  await window.click('[data-request-action="resend"]');
  check("Resend sends it to the new thread", [await phase("queued"), markers(TAKEOVER, 3)], [{ message: "Queued in T3", actions: ["open_thread", "withdraw"] }, 1]);

  t3.setMissing(TAKEOVER, true);
  // Rebaselined for ADR 009, the chip carries the thread's state: a request waiting on a lost thread used to say so
  // four times (the chip, a status beside it, a strip under the bar, and Start a fresh thread both in the bar and in
  // the chip's menu). Now the chip alone says Thread lost, and Start a fresh thread stands once in the bar beside it.
  await window.waitForSelector('[data-thread-chip][data-thread="lost"]', { timeout: PHASE_MS });
  check(
    "missing thread: the chip reads Thread lost in the warning's hue, the bar has no status or strip of its own, and offers Start a fresh thread, on though a request is open since that request goes with it, then Withdraw",
    await window.evaluate(() => {
      const chip = document.querySelector("[data-thread-chip]");
      const probe = document.body.appendChild(Object.assign(document.createElement("i"), { style: "color: var(--warning)" }));
      const warning = getComputedStyle(probe).color;
      probe.remove();
      const fresh = document.querySelector('[data-topbar] [data-request-action="fresh_thread"]');
      return {
        chip: chip.textContent.trim(),
        tone: getComputedStyle(chip.querySelector("[data-thread-title]")).color === warning,
        said: document.querySelectorAll("[data-topbar] [data-request-phase], [data-request-detail]").length,
        actions: [...document.querySelectorAll("[data-phase-actions] [data-request-action]")].map((e) => e.dataset.requestAction),
        fresh: [document.querySelectorAll('[data-topbar] [data-request-action="fresh_thread"], [data-refresh-thread]').length, fresh?.disabled],
      };
    }),
    { chip: "Thread lost", tone: true, said: 0, actions: ["fresh_thread", "withdraw"], fresh: [1, false] },
  );
  check("Regenerate is disabled while the thread is lost", await window.isDisabled("[data-regenerate-toggle]"), true);
  check("the lost chip's hint covers no header control, Start a fresh thread beside it least of all", await coveredBy("[data-thread-chip]"), []);
  await shot(window, shots, "8-thread-lost");
  await window.click("[data-thread-chip]");
  await window.waitForSelector("[data-thread-menu]");
  check(
    "the chip's menu says what happened and that the open request goes with a fresh thread, with no second Start a fresh thread and no Open in T3",
    await window.$eval("[data-thread-menu]", (menu) => [menu.querySelector("[data-slot=popover-description]")?.textContent, menu.querySelectorAll("button, a").length]),
    ["This brainstorm's thread is gone. Start a fresh thread and every branch carries on there, the open request with it.", 0],
  );
  await shot(window, shots, "8-thread-lost-menu");
  await window.mouse.move(120, 600);
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-thread-menu]", { state: "hidden" });
  await window.waitForTimeout(800);
  check(
    "Escape hands focus back to the chip, and its hint stays shut rather than pop up over the title because the menu closed",
    await window.evaluate(() => [document.activeElement?.matches("[data-thread-chip]") ?? false, document.querySelector('[data-slot="tooltip-content"]') !== null]),
    [true, false],
  );
  await window.click('[data-topbar] [data-request-action="fresh_thread"]');
  await window.waitForSelector('[data-request-phase="queued"]', { timeout: PHASE_MS });
  const fresh = t3.started();
  check("Start a fresh thread starts one T3 thread, and the open request follows to it", [fresh.length, markers(fresh[0]?.thread, 3)], [1, 1]);
  // Open thread takes Start a fresh thread's place under the pointer, so the pointer moves off before the shot, which
  // is of the bar, not of a hint.
  await window.mouse.move(120, 600);
  await window.waitForSelector('[data-slot="tooltip-content"]', { state: "detached" });
  await shot(window, shots, "9-fresh-thread");

  // A confirm the app writes itself asks nothing of the thread, so a lost thread holds Confirm only for what goes to the
  // agent (ADR 009). A second brainstorm, whose thread is gone while no request is open in it, shows both.
  const LOST = "44444444-4444-4444-8444-444444444444";
  t3.addThread(LOST, { projectId: "chore-roulette", title: "Lost thread" });
  const { session: stranded } = seedDemo(home, { T3CODE_THREAD_ID: LOST });
  t3.setMissing(LOST, true);
  await window.click("[data-back]");
  const strandedCanvas = await openSession(window, stranded);
  await showBoard(window, strandedCanvas);
  // The open brainstorm asks T3 after its thread when the window takes focus.
  await window.evaluate(() => dispatchEvent(new Event("focus")));
  await window.waitForSelector('[data-thread-chip][data-thread="lost"]', { timeout: PHASE_MS });
  check("on a lost thread with no request open, Regenerate is off", await window.isDisabled("[data-regenerate-toggle]"), true);
  await window.click("[data-slot-picker]");
  await window.click('[data-slot-option="wheel"]');
  await window.waitForSelector('[data-slot-picker="wheel"]');
  await window.hover('[data-slot-id] [data-variant="reel"]');
  await window.click('[data-approve="reel"]');
  await window.waitForSelector('[data-main-group] [data-variant="reel"]');
  check("but with nothing grafted Confirm is on, since the app writes that iteration itself", await window.isDisabled("[data-confirm-toggle]"), false);
  await window.click("[data-confirm-toggle]");
  await window.waitForSelector("[data-confirm-menu]");
  check(
    "and its popover says it applies at once, with Confirm on",
    [(await window.textContent("[data-confirm-hint]")).trim(), await window.isDisabled("[data-confirm-send]")],
    ["Applies at once", false],
  );
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-confirm-menu]", { state: "detached" });
  await window.click("[data-graft-toggle]");
  await strandedCanvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-graft-composer]");
  await window.click("[data-graft-add]");
  await window.waitForSelector("[data-graft]");
  await window.mouse.move(120, 600);
  await window.hover("[data-confirm-blocked]");
  check(
    "a graft goes to the agent, so then Confirm holds, saying the thread is gone",
    [
      await window.isDisabled("[data-confirm-toggle]"),
      await window
        .waitForSelector('[data-slot="tooltip-content"]', { state: "visible" })
        .then((h) => h.evaluate((el) => el.textContent.trim())),
    ],
    [true, "This brainstorm's thread is gone. Start a fresh thread from the top bar."],
  );
  await window.mouse.move(120, 600);
  await shot(window, shots, "10-lost-thread-confirm");
  await window.click("[data-remove-graft]");
  await window.waitForSelector("[data-graft]", { state: "detached" });
  const lostBefore = t3.messages(LOST).length;
  await window.click("[data-confirm-toggle]");
  await window.click("[data-confirm-send]");
  const narrowed = await window
    .waitForFunction(() => [...document.querySelectorAll('[data-slot-id="wheel"] [data-variant]')].map((r) => r.dataset.variant).join() === "reel", null, { timeout: 5000 })
    .then(() => true, () => false);
  check(
    "and Confirm with nothing grafted lands on the lost thread: the wheel keeps only Reel, with nothing sent to T3 and no notice",
    [narrowed, t3.messages(LOST).length - lostBefore, await window.evaluate(() => document.querySelector("[data-slot=toast]")?.textContent.trim() ?? null)],
    [true, 0, null],
  );
  // Once that confirm has landed, iteration 1 is in the past: a branch from there with nothing grafted applies at once
  // too, but a word on what to try goes to the agent, so it holds while the thread is gone.
  if (narrowed) {
    // The strip shows the run the confirm started, so iteration 1 is in the run before it.
    if ((await window.$("[data-history]")) === null) await window.click("[data-history-toggle]");
    await window.click("[data-strip-run]");
    await window.click('[data-run-option="Start"]');
    await window.click('[data-history-n="1"]');
    await window.waitForSelector("[data-past-bar]");
    await window.hover('[data-slot-id] [data-variant="neon"]');
    await window.click('[data-approve="neon"]');
    await window.waitForSelector('[data-main-group] [data-variant="neon"]');
    await window.click("[data-confirm-toggle]");
    await window.waitForSelector("[data-confirm-menu]");
    const branchLook = () =>
      window.evaluate(() => [
        document.querySelector("[data-confirm-hint]")?.textContent.trim(),
        document.querySelector("[data-confirm-held]")?.textContent.trim() ?? null,
        document.querySelector("[data-confirm-send]")?.disabled,
      ]);
    const unheld = await branchLook();
    await window.fill("[data-confirm-instruction]", "Try the neon for nights");
    check(
      "on the lost thread a branch with nothing grafted applies at once, but typing what it should try holds Confirm, saying the thread is gone",
      [unheld, await branchLook()],
      [
        ["Applies at once", null, false],
        ["Goes to the agent", "This brainstorm's thread is gone. Start a fresh thread from the top bar.", true],
      ],
    );
    await window.keyboard.press("Escape");
    await window.waitForSelector("[data-confirm-menu]", { state: "detached" });
  }

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
