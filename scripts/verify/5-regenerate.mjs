import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-5");
const { check, finish } = checks();
const t3 = fakeT3(env.BRAINSTORM_FAKE_T3_STATE);
const TAKEOVER = "33333333-3333-4333-8333-333333333333";
const PHASE_MS = 15_000;

const { app, window, errors } = await launch(home, env);

async function phase(name) {
  await window.waitForSelector(`[data-request-phase="${name}"]`, { timeout: PHASE_MS });
  return {
    message: (await window.textContent("[data-request-message]"))?.trim(),
    actions: await window.$$eval("[data-request-phase] [data-request-action]", (els) => els.map((e) => e.dataset.requestAction)),
  };
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
    "the menu lists the in-scope open feedback it will attach",
    await window.$$eval("[data-attached]", (els) => els.map((e) => e.dataset.attached)),
    ["1"],
  );
  await shot(window, shots, "1-menu");
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

  check("the fulfilled request names what changed", await phase("fulfilled"), { message: "Iteration 2 · changed wheel/neon", actions: [] });
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
    (await window.textContent('[data-feedback="1"] [data-feedback-meta]'))?.replace(/\s+/g, " ").trim(),
    "Neon wheel · spin-button · Addressed in 2",
  );
  check("Regenerate is enabled again", await window.isDisabled("[data-regenerate-toggle]"), false);
  await shot(window, shots, "3-fulfilled");

  await regenerate("all");
  await window.click("[data-regenerate-menu] [data-send]");
  check("queued", await phase("queued"), { message: "Queued in T3", actions: ["open_thread", "withdraw"] });
  await window.click('[data-request-action="open_thread"]');
  await window.waitForTimeout(300);
  check("Open thread opens the thread's link outside the app", await app.evaluate(() => globalThis.opened), [`https://app.t3.codes/threads/fake/${DEMO_THREAD}`]);

  t3.startRun(DEMO_THREAD);
  check("working", await phase("working"), { message: "The agent is working", actions: ["open_thread", "withdraw"] });
  check("working shows progress", await window.isVisible("[data-request-phase] [data-progress]"), true);
  t3.ask(DEMO_THREAD);
  check("asking", await phase("asking"), { message: "The agent is asking something in T3", actions: ["open_thread", "withdraw"] });
  check("asking shows no spinner", await window.$("[data-request-phase] [data-progress]"), null);
  await shot(window, shots, "4-asking");

  t3.endRun(DEMO_THREAD, "failed");
  check("run failed", await phase("run_failed"), { message: "The agent's run failed in T3", actions: ["retry", "withdraw"] });
  await shot(window, shots, "5-run-failed");
  const beforeRetry = t3.sent().length;
  await window.click('[data-request-action="retry"]');
  check("Retry after a failed run sends the request again", [await phase("queued"), t3.sent().length - beforeRetry], [{ message: "Queued in T3", actions: ["open_thread", "withdraw"] }, 1]);

  t3.startRun(DEMO_THREAD);
  await phase("working");
  t3.endRun(DEMO_THREAD, "completed");
  check("no change", await phase("no_change"), { message: "The agent replied in T3 without changing the design", actions: ["retry", "withdraw"] });
  await window.click('[data-request-action="withdraw"]');
  check("Withdraw closes the request", await phase("withdrawn"), { message: "Withdrawn", actions: [] });

  t3.setFailAfter(["send"]);
  await regenerate("described", "try a calmer palette everywhere");
  await window.click("[data-regenerate-menu] [data-send]");
  check("send failed", await phase("send_failed"), {
    message: "Couldn't send: fake t3 failure: the reply was lost. The request is saved.",
    actions: ["retry", "withdraw"],
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
  check("previous thread", await phase("previous_thread"), { message: "Sent to the previous thread", actions: ["resend", "withdraw"] });
  await shot(window, shots, "7-previous-thread");
  await window.click('[data-request-action="resend"]');
  check("Resend sends it to the new thread", [await phase("queued"), markers(TAKEOVER, 3)], [{ message: "Queued in T3", actions: ["open_thread", "withdraw"] }, 1]);

  t3.setMissing(TAKEOVER, true);
  const phrase = 'pick up the brainstorm session titled "Chore roulette"';
  check("missing thread", await phase("thread_lost"), {
    message: `This session's thread is gone. In a T3 thread on this project, say: ${phrase}`,
    actions: ["copy_phrase", "withdraw"],
  });
  check("the session shows as unattached", (await window.textContent('[data-thread="lost"]'))?.trim(), "Unattached");
  await window.click('[data-request-phase] [data-request-action="copy_phrase"]');
  await window.waitForSelector('[data-request-phase] [data-request-action="copy_phrase"]:has-text("Copied")');
  check("Copy phrase puts the takeover phrase on the clipboard", await app.evaluate(({ clipboard }) => clipboard.readText()), phrase);
  await shot(window, shots, "8-thread-lost");
  await window.click('[data-request-action="withdraw"]');
  await phase("withdrawn");
  check(
    "with no request open, the top bar still offers the takeover phrase",
    (await window.textContent("[data-takeover]"))?.replace(/\s+/g, " ").trim(),
    `In a T3 thread on this project, say: ${phrase}Copy phrase`,
  );
  check("Regenerate is disabled while the session is unattached", await window.isDisabled("[data-regenerate-toggle]"), true);
  await shot(window, shots, "9-unattached");

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
