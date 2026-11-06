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
      `[brainstorm] session ${session} · request 1 · scope: wheel/neon · feedback: #1 · freetext: "make the spin feel less random"\nHandle with the ux-brainstorm skill: run \`brainstorm context ${session}\`.`,
    ],
  );
  check("Regenerate is disabled while the request is open", await window.isDisabled("[data-regenerate-toggle]"), true);
  await shot(window, shots, "2-queued");

  t3.startRun(DEMO_THREAD);
  check("the agent picking it up shows as working", await phase("working"), { message: "The agent is working", actions: ["open_thread", "withdraw"] });
  check(
    "working's live dot sits in a 14 px halo, the optical size of the other phases' glyphs",
    await window.$eval("[data-request-phase=working] [data-phase-glyph]", (g) => Math.round(g.getBoundingClientRect().width)),
    14,
  );
  await window.setViewportSize({ width: 1100, height: 720 });
  check(
    "at 1100 with a request open the phase actions give up their labels for icons, so the title keeps 160 px or reads whole, and the status message reads whole",
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
    [[28, 28], true, true],
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
    window.$$eval('[data-phase-actions] :is([data-request-action="open_thread"], [data-request-action="withdraw"])', (els) => els.map((el) => Math.round(el.getBoundingClientRect().left)).join());
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
  await window.mouse.move(120, 600);
  await window.setViewportSize({ width: 1100, height: 720 });
  check("nor at 1100", await headerHints(), [[], [], []]);
  check(
    "at 1100 with a request open, Fork and Export give up their labels for icons, so the title still reads whole",
    await settled(() =>
      window.evaluate(() => {
        const title = document.querySelector("[data-session-title]");
        return [
          ["[data-fork-toggle]", "[data-export]"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().width)),
          title.scrollWidth <= title.clientWidth,
        ];
      }),
    ),
    [[28, 28], true],
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.click('[data-request-action="open_thread"]');
  await window.waitForTimeout(300);
  check("Open thread opens the thread's link outside the app", await app.evaluate(() => globalThis.opened), [`https://app.t3.codes/threads/fake/${DEMO_THREAD}`]);

  t3.startRun(DEMO_THREAD);
  check("working", await phase("working"), { message: "The agent is working", actions: ["open_thread", "withdraw"] });
  check("working shows progress", await window.isVisible("[data-request-phase] [data-progress]"), true);
  at.push(await withdrawAt());
  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector(`[data-overview-session="${session}"] [data-session-status="working"]`, { timeout: PHASE_MS });
  check(
    "home shows the request's phase on the brainstorm's row and card, in the accent while the agent works",
    await window.evaluate((id) => {
      const row = document.querySelector(`[data-session="${id}"] [data-session-status]`);
      const card = document.querySelector(`[data-overview-session="${id}"] [data-session-status]`);
      const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim();
      const probe = document.body.appendChild(Object.assign(document.createElement("i"), { style: `color: ${accent}` }));
      const tone = getComputedStyle(probe).color;
      probe.remove();
      return { row: row.textContent.trim(), card: card.textContent.trim(), tone: [row, card].every((el) => getComputedStyle(el).color === tone), pulses: row.querySelector(".animate-ping") !== null };
    }, session),
    { row: "Agent working", card: "Agent working", tone: true, pulses: true },
  );
  await openSession(window, session);
  await window.waitForSelector('[data-request-phase="working"]');
  t3.ask(DEMO_THREAD);
  check("asking", await phase("asking"), { message: "The agent is asking something in T3", actions: ["open_thread", "withdraw"] });
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
  check("Open thread and Withdraw keep one x from queued through working, asking, run failed and no change", new Set(at).size, 1);
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
  await shot(window, shots, "7-previous-thread");
  await window.click('[data-request-action="resend"]');
  check("Resend sends it to the new thread", [await phase("queued"), markers(TAKEOVER, 3)], [{ message: "Queued in T3", actions: ["open_thread", "withdraw"] }, 1]);

  t3.setMissing(TAKEOVER, true);
  const phrase = 'pick up the brainstorm session titled "Chore roulette"';
  check("missing thread", await phase("thread_lost"), { message: "This brainstorm's thread is gone. In a T3 thread on this project, say:", actions: ["withdraw"] });
  check(
    "the strip holds the takeover phrase on its own line, with Copy phrase beside it at the same height, 8 px off",
    await window.$eval("[data-request-detail]", (el) => {
      const phrase = el.querySelector("[data-takeover-phrase]");
      const copy = el.querySelector('[data-request-action="copy_phrase"]').getBoundingClientRect();
      const box = phrase.getBoundingClientRect();
      return [
        phrase.textContent,
        getComputedStyle(phrase).fontFamily.includes("Cascadia") || getComputedStyle(phrase).fontFamily.includes("mono"),
        [Math.round(box.top), Math.round(box.bottom)].join() === [Math.round(copy.top), Math.round(copy.bottom)].join(),
        Math.round(copy.left - box.right),
      ];
    }),
    [phrase, true, true, 8],
  );
  check("the session's thread reads Thread lost, the bar's term", (await window.textContent('[data-thread="lost"]'))?.trim(), "Thread lost");
  await window.click('[data-request-detail] [data-request-action="copy_phrase"]');
  await window.waitForSelector('[data-request-detail] [data-request-action="copy_phrase"] [data-copied]');
  check("Copy phrase puts the takeover phrase on the clipboard", await app.evaluate(({ clipboard }) => clipboard.readText()), phrase);
  await shot(window, shots, "8-thread-lost");
  await window.click('[data-request-action="withdraw"]');
  await window.waitForSelector('[data-thread-lost][data-request-phase="withdrawn"]', { timeout: PHASE_MS });
  check("once withdrawn, the bar still names the lost thread, not the withdrawal", (await window.textContent("[data-thread-lost]"))?.trim(), "Thread lost");
  check(
    "with no request open, the top bar still offers the takeover phrase",
    await window.$eval("[data-takeover]", (el) => [...el.querySelectorAll("p")].map((p) => p.textContent).concat(el.querySelector("button")?.innerText.trim())),
    ["In a T3 thread on this project, say:", phrase, "Copy phrase"],
  );
  check("Regenerate is disabled while the session is unattached", await window.isDisabled("[data-regenerate-toggle]"), true);
  await window.setViewportSize({ width: 1100, height: 720 });
  check(
    "in the 240 px sidebar at 1100 the phrase takes the callout's full width, under its icon too, and keeps to three lines",
    await settled(() =>
      window.$eval("[data-takeover]", (el) => {
        const callout = el.querySelector("[data-slot=callout]").getBoundingClientRect();
        const phrase = el.querySelector("[data-takeover-phrase]");
        const box = phrase.getBoundingClientRect();
        const style = getComputedStyle(phrase);
        const lines = Math.round((box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight));
        return [Math.round(box.left - callout.left), Math.round(callout.right - box.right) <= 12, lines <= 3];
      }),
    ),
    [12, true, true],
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  await shot(window, shots, "9-unattached");

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
