import { build, checks, launch, settled, workspace } from "./electron.mjs";
import { brainstorm, seedDemo } from "../seed-demo.mjs";

build();
const { home, env } = workspace("verify-9");
const { check, finish } = checks();
const { app, window, errors } = await launch(home, env);

const TITLE_FLOOR = 160;
const ANCESTOR_FLOOR = 64;
const NOW = new Date().toISOString();

/** Every phase as the server words it, with the actions `requestPhase` gives it on an attached thread. */
const PHASES = {
  sending: { message: "Sending to T3", actions: [] },
  queued: { message: "Queued in T3", actions: ["open_thread", "withdraw"] },
  working: { message: "Agent working", actions: ["open_thread", "withdraw"] },
  asking: { message: "Agent asking in T3", actions: ["open_thread", "withdraw"] },
  run_failed: { message: "The agent's run failed in T3", actions: ["retry", "open_thread", "withdraw"] },
  no_change: { message: "The agent replied in T3 without changing the design", actions: ["retry", "open_thread", "withdraw"] },
  send_failed: { message: "Couldn't send (T3 is not running). The request is saved.", actions: ["retry", "open_thread", "withdraw"], error: "T3 is not running" },
  previous_thread: { message: "Sent to the previous thread", actions: ["resend", "open_thread", "withdraw"] },
  thread_lost: { message: "This brainstorm's thread is gone. Start a fresh thread, and the open request goes to it.", actions: ["fresh_thread", "withdraw"], lost: true },
  fulfilled: { message: "Iteration 2 · changed Neon wheel and Assignment card", actions: [], iteration: 2 },
  withdrawn: { message: "Request withdrawn", actions: [] },
};

/** Each case's title, and for a branch the primary line the breadcrumb leads with. */
const TITLES = {
  short: { title: "Chore roulette", primary: null },
  long: { title: "Onboarding a new flatmate into the chore rota without a fight", primary: null },
  branch: { title: "Try a calmer wheel for mornings", primary: { id: "s_parent", title: "Rota handover" } },
  rota: { title: "Rota handover", primary: null },
};

let shape = null;

/** The real view with the case's title, its tree and request laid over it. */
function dress(view) {
  if (shape === null) return view;
  const { title, primary } = TITLES[shape.title];
  const phase = shape.phase === null ? null : { ...PHASES[shape.phase], ...(shape.message === undefined ? {} : { message: shape.message }) };
  const thread = view.attachment.threadId;
  // Five minutes before each fetch, so every case reads one count, whenever in the run it lands.
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  return {
    ...view,
    session: { ...view.session, title },
    tree: primary === null ? { root: { id: view.session.id, title }, primary: view.session.id } : { root: primary, primary: primary.id },
    attachment: { ...view.attachment, lostAt: phase?.lost ? NOW : null },
    regenerate: phase === null || phase.actions.length === 0 ? view.regenerate : { ok: false, reason: "request_open" },
    request:
      phase === null
        ? null
        : {
            request: { session: view.session.id, n: 1, scope: { kind: "all" }, freetext: null, feedbackIds: [], base: 1, threadId: thread, state: { state: "sent" }, sentAt: since, createdAt: since },
            phase: { phase: shape.phase, actions: phase.actions, ...(phase.error === undefined ? {} : { error: phase.error }), ...(phase.iteration === undefined ? {} : { iteration: phase.iteration }) },
            message: phase.message,
          },
  };
}

/**
 * Measures the header as Rob would judge it, independently of the app's own fit: which collapsible parts gave up
 * their words, whether the breadcrumb keeps its floors, whether restoring the last part to give way would break them
 * (so nothing gave way while there was room), and whether every word that shows reads whole inside the header.
 */
const measure = () =>
  window.evaluate(
    ([titleFloor, ancestorFloor]) => {
      const header = document.querySelector("[data-topbar]");
      const ink = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width;
      };
      const box = (el) => {
        const s = getComputedStyle(el);
        return el.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
      };
      const whole = (el) => ink(el) <= box(el) + 0.01;
      const roomy = (el, floor) => box(el) >= Math.min(ink(el), floor) - 0.01;
      const fits = () =>
        roomy(header.querySelector("[data-session-title]"), titleFloor) && [...header.querySelectorAll("[data-breadcrumb-root]")].every((a) => roomy(a, ancestorFloor));
      const steps = [...header.querySelectorAll("[data-collapse]")].sort((a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse));
      const name = (el) => el.dataset.requestAction ?? (el.matches("[data-thread-chip]") ? "thread" : el.matches("[data-export]") ? "export" : el.matches("[data-status-elapsed]") ? "elapsed" : el.matches("svg") ? "glyph" : "status");
      const collapsed = steps.filter((s) => s.hasAttribute("data-collapsed"));
      // The glyph and the time are marks, not labels, so either comes back once a later label frees its room.
      const labels = steps.filter((s) => Number(s.dataset.collapse) >= 2);
      const inOrder = labels.filter((s) => s.hasAttribute("data-collapsed")).every((s, i) => s === labels[i]);
      const back = (part) => {
        part.removeAttribute("data-collapsed");
        const broke = !fits();
        const title = header.querySelector("[data-session-title]");
        const by = Math.round(ink(title) - box(title));
        part.setAttribute("data-collapsed", "");
        return { broke, by };
      };
      // Labels give way in rank order, so only the last is judged; a mark that gave way must still be needed.
      const needed = collapsed.filter((part) => !labels.includes(part) || part === collapsed.at(-1)).every((part) => back(part).broke);
      const shortBy = collapsed.length === 0 ? 0 : back(collapsed.at(-1)).by;
      const bar = header.getBoundingClientRect();
      const words = [...header.querySelectorAll("[data-request-message], [data-request-label], [data-request-short], [data-regenerate-toggle], [data-collapse]:not([data-collapsed]) span")].filter(
        // A dot's empty span is a mark, not a word.
        (el) => el.getClientRects().length > 0 && el.textContent.trim() !== "",
      );
      const controls = [...header.querySelectorAll("button, a")].filter((el) => el.getClientRects().length > 0);
      return {
        collapsed: collapsed.map(name),
        elapsed: header.querySelector("[data-status-elapsed]:not([data-collapsed])")?.textContent ?? null,
        title: header.querySelector("[data-session-title]").textContent,
        cut: header.querySelector("[data-session-title]").dataset.cut ?? null,
        titleShown: Math.round(Math.min(box(header.querySelector("[data-session-title]")), ink(header.querySelector("[data-session-title]")))),
        titleWhole: whole(header.querySelector("[data-session-title]")),
        regenerate: Math.round(header.querySelector("[data-regenerate-toggle]").getBoundingClientRect().width * 100) / 100,
        floors: fits() || collapsed.length === steps.length,
        inOrder,
        needed,
        shortBy,
        whole: words.filter((el) => !whole(el)).map((el) => el.textContent),
        inside: controls.every((el) => el.getBoundingClientRect().right <= bar.right && el.getBoundingClientRect().left >= bar.left),
      };
    },
    [TITLE_FLOOR, ANCESTOR_FLOOR],
  );

try {
  const { session } = seedDemo(home, env);
  const spare = brainstorm(env, ["session", "new", "--title", "Spare", "--brief", "A second brainstorm to switch through", "--json"]).json.data.session.id;
  // The view's load and the thread check both answer with the whole view, so both are dressed.
  const dressed = async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: body.ok && body.data?.session !== undefined ? { ...body, data: dress(body.data) } : body });
  };
  await app.context().route(`**/v1/ui/sessions/${session}`, (route) => (route.request().method() === "GET" ? dressed(route) : route.continue()));
  await app.context().route(`**/v1/ui/sessions/${session}/actions`, dressed);
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForSelector(`[data-session="${session}"]`);

  await window.click(`[data-session="${spare}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  check(
    "once its view loads, a brainstorm with no iteration yet shows no strip, and its history toggle is off and doesn't read pressed",
    // While the view loads, the strip's skeleton holds its place (R6-6), so only the loaded view can tell.
    await settled(() =>
      window.evaluate(() => {
        const toggle = document.querySelector("[data-history-toggle]");
        return [document.querySelector("[data-history], [data-history-loading]") !== null, toggle.getAttribute("aria-pressed"), toggle.disabled];
      }),
    ),
    [false, "false", true],
  );
  await window.click("[data-back]");

  const results = new Map();
  for (const theme of ["light", "dark"]) {
    await window.emulateMedia({ colorScheme: theme });
    for (const [width, height] of [
      [1440, 900],
      [1100, 720],
    ]) {
      await window.setViewportSize({ width, height });
      for (const title of ["short", "long", "branch"]) {
        for (const phase of [null, ...Object.keys(PHASES)]) {
          shape = { title, phase };
          // Home keeps an open brainstorm's view until another is chosen, so opening the spare first makes the app
          // fetch the dressed view.
          for (const id of [spare, session]) {
            if (await window.$('[data-sidebar-panel="session"]')) await window.click("[data-back]");
            await window.click(`[data-session="${id}"]`);
            await window.waitForSelector('[data-sidebar-panel="session"]');
          }
          await window.waitForFunction((t) => document.querySelector("[data-session-title]")?.textContent === t, TITLES[title].title, { timeout: 5000 });
          if (phase !== null) await window.waitForSelector(`[data-topbar] [data-request-phase="${phase}"], [data-topbar] [data-thread-lost]`, { timeout: 5000 });
          const m = await settled(measure);
          const label = `${theme} ${width} ${title} ${phase ?? "idle"}`;
          results.set(label, m);
          check(
            `${label}: title keeps ${TITLE_FLOOR} px or whole, gives way in rank order and no further than needed, words whole`,
            { floors: m.floors, inOrder: m.inOrder, needed: m.needed, whole: m.whole, inside: m.inside },
            { floors: true, inOrder: true, needed: true, whole: [], inside: true },
          );
        }
      }
    }
  }

  /** Opens the dressed brainstorm afresh, through the spare, so the app fetches the view `shape` dresses. */
  const reopen = async () => {
    for (const id of [spare, session]) {
      if (await window.$('[data-sidebar-panel="session"]')) await window.click("[data-back]");
      await window.click(`[data-session="${id}"]`);
      await window.waitForSelector('[data-sidebar-panel="session"]');
    }
    await window.waitForFunction((t) => document.querySelector("[data-session-title]")?.textContent === t, TITLES[shape.title].title, { timeout: 5000 });
  };
  const verdict = (m) => ({ floors: m.floors, inOrder: m.inOrder, needed: m.needed, whole: m.whole });
  const fitted = { floors: true, inOrder: true, needed: true, whole: [] };

  // Shot 71: a request turns fulfilled in place, its result naming one block, while "Rota handover" all but fills its
  // room. The room's fraction of a pixel depends on every width around it, so the badge is nudged a tenth at a time
  // over a whole pixel of the title's shortfall, where rounded widths read a title 0.6 px short as whole.
  await window.emulateMedia({ colorScheme: "light" });
  await window.setViewportSize({ width: 1100, height: 720 });
  shape = { title: "rota", phase: "working" };
  await reopen();
  await window.waitForSelector('[data-topbar] [data-request-phase="working"]');
  shape = { title: "rota", phase: "fulfilled", message: "Iteration 3 · changed Assignment card" };
  await window.click('[data-variant="reel"]');
  await window.waitForSelector('[data-topbar] [data-request-phase="fulfilled"]');
  const shortfall = await window.evaluate(() => {
    const header = document.querySelector("[data-topbar]");
    const gone = [...header.querySelectorAll("[data-collapsed]")];
    for (const part of gone) part.removeAttribute("data-collapsed");
    const title = header.querySelector("[data-session-title]");
    const range = document.createRange();
    range.selectNodeContents(title);
    const by = range.getBoundingClientRect().width - title.getBoundingClientRect().width;
    for (const part of gone) part.setAttribute("data-collapsed", "");
    return by;
  });
  await window.setViewportSize({ width: 1100 + Math.floor(shortfall), height: 720 });
  const nudged = [];
  for (let tenth = 0; tenth < 10; tenth++) {
    await window.evaluate((px) => {
      const style = document.getElementById("nudge") ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: "nudge" }));
      style.textContent = `[data-topbar] [data-iteration] { margin-left: ${px}px }`;
    }, tenth / 10);
    const m = await settled(measure);
    if (JSON.stringify(verdict(m)) !== JSON.stringify(fitted)) nudged.push({ nudge: tenth / 10, ...verdict(m), gaveWay: m.collapsed, title: m.titleShown });
  }
  await window.evaluate(() => document.getElementById("nudge")?.remove());
  check("a request fulfilled in place, its result naming one block, never leaves the title cut by a fraction of a pixel while labels stay", nudged, []);

  // The status's words change with nothing else in the header moving: the fit hears the status itself, not only what
  // its change pushes on, so labels that gave way come back when the words shorten.
  await window.setViewportSize({ width: 1100, height: 720 });
  shape = { title: "short", phase: "queued" };
  await reopen();
  await window.waitForSelector('[data-topbar] [data-request-phase="queued"]');
  await settled(measure);
  await window.evaluate(() => {
    const words = [...document.querySelectorAll("[data-topbar] [data-request-short], [data-topbar] [data-request-message]")].find((el) => el.getClientRects().length > 0);
    words.firstChild.textContent = "";
  });
  check("when the status's words shorten and nothing else in the header moves, every label that gave way is still needed", verdict(await settled(measure)), fitted);

  shape = { title: "short", phase: null };
  await window.setViewportSize({ width: 1440, height: 900 });
  let hold = null;
  await app.context().route(`**/v1/ui/sessions/${spare}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((r) => (hold = r));
    await route.continue();
  });
  if (await window.$('[data-sidebar-panel="session"]')) await window.click("[data-back]");
  await window.click(`[data-session="${spare}"]`);
  await window.waitForSelector("[data-topbar] [data-regenerate-toggle]");
  const loading = await window.$eval("[data-topbar] [data-regenerate-toggle]", (el) => Math.round(el.getBoundingClientRect().width * 100) / 100);
  while (hold === null) await new Promise((r) => setTimeout(r, 50));
  hold();
  await window.waitForSelector("[data-topbar] [data-regenerate-blocked], [data-topbar] [data-regenerate-toggle]:not([disabled])");
  await app.context().unroute(`**/v1/ui/sessions/${spare}`);
  const landed = await settled(() => window.$eval("[data-topbar] [data-regenerate-toggle]", (el) => Math.round(el.getBoundingClientRect().width * 100) / 100));
  check("while a brainstorm loads, its Regenerate holds the width it lands with, glyph and all", loading, landed);

  const gaveWay = (label) => results.get(label)?.collapsed;
  check(
    "at 1440 with a short title, Regenerate keeps one shape in every phase: unless the fit takes its glyph, it is as wide with a request open as with none",
    Object.keys(PHASES).filter((p) => !gaveWay(`light 1440 short ${p}`)?.includes("glyph") && results.get(`light 1440 short ${p}`)?.regenerate !== results.get("light 1440 short idle")?.regenerate),
    [],
  );
  check(
    "at 1440 with a short title, the header counts how long a running request has been open, as the sidebar does, and an ended one counts nothing",
    Object.fromEntries(Object.keys(PHASES).map((p) => [p, /^\d+[smh]/.test(results.get(`light 1440 short ${p}`)?.elapsed ?? "")])),
    Object.fromEntries(Object.keys(PHASES).map((p) => [p, ["sending", "queued", "working", "asking", "previous_thread"].includes(p)])),
  );
  check(
    "at 1440 a short title keeps every label while sending, withdrawn or idle; with a request open or fulfilled the thread chip folds to its dot first, in previous thread the status folds to \"Previous thread\" and Export gives way too, in ADR 003's order, and the title reads whole in every phase",
    Object.fromEntries(Object.keys(PHASES).map((p) => [p, [gaveWay(`light 1440 short ${p}`)?.join(), results.get(`light 1440 short ${p}`)?.titleWhole]])),
    Object.fromEntries(Object.keys(PHASES).map((p) => [p, [{ queued: "thread", working: "thread", asking: "thread", run_failed: "thread", no_change: "thread", send_failed: "thread", previous_thread: "glyph,thread,status,export", thread_lost: "glyph", fulfilled: "thread" }[p] ?? "", true]])),
  );
  check(
    "at 1440 in previous thread, the room left of Resend is short of Export's label: putting it back cuts \"Chore roulette\" by 20 px or more",
    results.get("light 1440 short previous_thread")?.shortBy >= 20,
    true,
  );
  check("at 1100 with a short title and a request queued, the marks go, the thread chip folds to its dot, the status drops \"in T3\" and Export gives way, so Withdraw and Open thread keep their names and the title reads whole", [gaveWay("light 1100 short queued"), results.get("light 1100 short queued")?.titleWhole], [["glyph", "elapsed", "thread", "status", "export"], true]);
  check(
    "at 1100 a long title with a send failure keeps 160 px or more, and Retry, the recovery, is the last label to give way",
    [gaveWay("light 1100 long send_failed"), results.get("light 1100 long send_failed")?.titleShown >= TITLE_FLOOR],
    [["thread", "export", "open_thread", "withdraw", "retry"], true],
  );
  check(
    "at 1440 a branch's title reads whole while idle or beside a recovery, its primary's crumb giving way first, and keeps 160 px in every phase whose status and actions fill it",
    Object.keys(PHASES)
      .filter((p) => !results.get(`light 1440 branch ${p}`)?.titleWhole)
      .map((p) => [p, results.get(`light 1440 branch ${p}`)?.titleShown >= TITLE_FLOOR]),
    [
      ["sending", true],
      ["queued", true],
      ["working", true],
      ["asking", true],
      ["previous_thread", true],
    ],
  );
  check("a fulfilled request's long result gives way to its short name before a long title is cut under 160 px", results.get("light 1440 long fulfilled")?.titleShown >= TITLE_FLOOR, true);
  check(
    "the two themes fit the header the same way",
    [...results].filter(([label]) => label.startsWith("light")).filter(([label, m]) => JSON.stringify(results.get(label.replace("light", "dark"))?.collapsed) !== JSON.stringify(m.collapsed)).map(([l]) => l),
    [],
  );
  console.log(
    [...results]
      .filter(([l]) => l.startsWith("light"))
      .map(([l, m]) => `  ${l.padEnd(34)} title ${String(m.titleShown).padStart(4)} px  gave way: ${m.collapsed.join(", ") || "nothing"}${m.collapsed.length > 0 ? `, last one back cuts the title by ${m.shortBy} px` : ""}`)
      .join("\n"),
  );
  const cuts = [...results].filter(([, m]) => m.cut !== null);
  check(
    "a cut title ends on a letter, never on a space or a comma, and keeps its whole text for copy and the screen reader",
    cuts.filter(([, m]) => /[\s,.;:·]…$/.test(m.cut) || !m.title.startsWith(m.cut.slice(0, -1))).map(([l, m]) => `${l}: ${m.cut}`),
    [],
  );
  check(
    "at 1100 a branch's title beside a send failure keeps more than 160 px, its primary's crumb giving way first, and cuts on a letter, not after a space, in both themes",
    ["light", "dark"].map((t) => results.get(`${t} 1100 branch send_failed`)?.cut),
    ["Try a calmer wheel for mor…", "Try a calmer wheel for mor…"],
  );
  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
