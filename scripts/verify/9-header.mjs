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
  sending: { message: "Sending to T3…", actions: [] },
  queued: { message: "Queued in T3", actions: ["open_thread", "withdraw"] },
  working: { message: "The agent is working", actions: ["open_thread", "withdraw"] },
  asking: { message: "The agent is asking something in T3", actions: ["open_thread", "withdraw"] },
  run_failed: { message: "The agent's run failed in T3", actions: ["retry", "open_thread", "withdraw"] },
  no_change: { message: "The agent replied in T3 without changing the design", actions: ["retry", "open_thread", "withdraw"] },
  send_failed: { message: "Couldn't send (T3 is not running). The request is saved.", actions: ["retry", "open_thread", "withdraw"], error: "T3 is not running" },
  previous_thread: { message: "Sent to the previous thread", actions: ["resend", "open_thread", "withdraw"] },
  thread_lost: { message: "This session's thread is gone.", actions: ["copy_phrase", "withdraw"], lost: true },
  starting: { message: "Starting a T3 thread…", actions: [] },
  start_failed: { message: "Couldn't start a T3 thread (T3 is not running). The fork is saved.", actions: ["retry", "discard"], error: "T3 is not running" },
  fulfilled: { message: "Iteration 2 · changed Neon wheel and Assignment card", actions: [], iteration: 2 },
  withdrawn: { message: "Request withdrawn", actions: [] },
};

const TITLES = {
  short: { title: "Chore roulette", lineage: [] },
  long: { title: "Onboarding a new flatmate into the chore rota without a fight", lineage: [] },
  fork: { title: "Try a calmer wheel for mornings", lineage: [{ id: "s_parent", title: "Rota handover", gone: false }] },
};

let shape = null;

/** The real view with the case's title, lineage and request laid over it. */
function dress(view) {
  if (shape === null) return view;
  const { title, lineage } = TITLES[shape.title];
  const phase = shape.phase === null ? null : PHASES[shape.phase];
  const thread = view.attachment.threadId;
  return {
    ...view,
    session: { ...view.session, title },
    lineage,
    attachment: { ...view.attachment, lostAt: phase?.lost ? NOW : null },
    regenerate: phase === null || phase.actions.length === 0 ? view.regenerate : { ok: false, reason: "request_open" },
    request:
      phase === null
        ? null
        : {
            request: { session: view.session.id, n: 1, scope: { kind: "all" }, freetext: null, feedbackIds: [], base: 1, threadId: thread, state: { state: "sent" }, sentAt: NOW, createdAt: NOW },
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
      const roomy = (el, floor) => el.clientWidth >= Math.min(el.scrollWidth, floor);
      const fits = () =>
        roomy(header.querySelector("[data-session-title]"), titleFloor) && [...header.querySelectorAll("[data-lineage]")].every((a) => roomy(a, ancestorFloor));
      const steps = [...header.querySelectorAll("[data-collapse]")].sort((a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse));
      const name = (el) => el.dataset.requestAction ?? (el.matches("[data-fork-toggle]") ? "fork" : el.matches("[data-export]") ? "export" : "status");
      const collapsed = steps.filter((s) => s.hasAttribute("data-collapsed"));
      const inOrder = collapsed.every((s, i) => s === steps[i]);
      const last = collapsed.at(-1);
      let needed = true;
      if (last !== undefined) {
        last.removeAttribute("data-collapsed");
        needed = !fits();
        last.setAttribute("data-collapsed", "");
      }
      const box = header.getBoundingClientRect();
      const words = [...header.querySelectorAll("[data-request-message], [data-request-label], [data-request-short], [data-regenerate-toggle], [data-collapse]:not([data-collapsed]) span")].filter(
        (el) => el.getClientRects().length > 0,
      );
      const controls = [...header.querySelectorAll("button, a")].filter((el) => el.getClientRects().length > 0);
      return {
        collapsed: collapsed.map(name),
        title: header.querySelector("[data-session-title]").textContent,
        titleShown: Math.round(header.querySelector("[data-session-title]").clientWidth),
        titleWhole: header.querySelector("[data-session-title]").scrollWidth <= header.querySelector("[data-session-title]").clientWidth,
        floors: fits() || collapsed.length === steps.length,
        inOrder,
        needed,
        whole: words.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
        inside: controls.every((el) => el.getBoundingClientRect().right <= box.right && el.getBoundingClientRect().left >= box.left),
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

  const results = new Map();
  for (const theme of ["light", "dark"]) {
    await window.emulateMedia({ colorScheme: theme });
    for (const [width, height] of [
      [1440, 900],
      [1100, 720],
    ]) {
      await window.setViewportSize({ width, height });
      for (const title of Object.keys(TITLES)) {
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

  const gaveWay = (label) => results.get(label)?.collapsed;
  check(
    "at 1440 a short title keeps every label but in asking, whose status takes its short name, and previous thread, which also gives up Export, and reads whole in every phase",
    Object.fromEntries(Object.keys(PHASES).map((p) => [p, [gaveWay(`light 1440 short ${p}`)?.join(), results.get(`light 1440 short ${p}`)?.titleWhole]])),
    Object.fromEntries(Object.keys(PHASES).map((p) => [p, [p === "asking" ? "status" : p === "previous_thread" ? "status,export" : "", true]])),
  );
  check("at 1100 with a short title and a request queued, Export, Fork and Withdraw give way, Open thread keeps its name and the title reads whole", [gaveWay("light 1100 short queued"), results.get("light 1100 short queued")?.titleWhole], [["export", "fork", "withdraw"], true]);
  check(
    "at 1100 a long title with a send failure keeps 160 px or more, and Retry, the recovery, is the last label to give way",
    [gaveWay("light 1100 long send_failed"), results.get("light 1100 long send_failed")?.titleShown >= TITLE_FLOOR],
    [["export", "fork", "withdraw", "open_thread", "retry"], true],
  );
  check(
    "at 1440 a fork's title reads whole in every phase but the three whose remaining labels fill the bar, where it keeps 160 px",
    Object.keys(PHASES)
      .filter((p) => !results.get(`light 1440 fork ${p}`)?.titleWhole)
      .map((p) => [p, results.get(`light 1440 fork ${p}`)?.titleShown >= TITLE_FLOOR]),
    [
      ["previous_thread", true],
      ["thread_lost", true],
      ["start_failed", true],
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
      .map(([l, m]) => `  ${l.padEnd(34)} title ${String(m.titleShown).padStart(4)} px  gave way: ${m.collapsed.join(", ") || "nothing"}`)
      .join("\n"),
  );
  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
