import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import type { BlockId, FeedbackId, FileMap, IterationN, Marks, PartName, PropName, Result, SessionId, SlotId, ThreadId, VariantKey } from "../src/core/types";
import { FakeBridge } from "./fakeBridge";
import { wheelProps } from "./fixtures";

const checker = createChecker({ size: 2 });
afterAll(() => checker.close());

const AT = "2026-11-05T10:00:00.000Z";
const T1 = "11111111-1111-1111-1111-111111111111" as ThreadId;
const T2 = "22222222-2222-2222-2222-222222222222" as ThreadId;
const T3 = "33333333-3333-3333-3333-333333333333" as ThreadId;
const S = "s_wheel01" as SessionId;
const NEON = "wheel/neon" as BlockId;
const SHEET = "result/sheet" as BlockId;

const neonTsx = `export default function Wheel({ people, accent }) {
  return (
    <div style={{ color: accent }}>
      {people.map((p) => <span key={p.name} data-part={\`slice-\${p.name}\`}>{p.name}</span>)}
      <button data-part="spin-button">Spin</button>
    </div>
  );
}
`;
const sheetTsx = `export default function Sheet({ headline }) {
  return <section data-part="sheet">{headline}</section>;
}
`;
const neonJson = JSON.stringify({ title: "Neon wheel", props: wheelProps });
const sheetJson = JSON.stringify({ title: "Result sheet", props: { appearance: { headline: { type: "text", label: "Headline", default: "Kai" } } } });

type BlockSpec = { tsx: string; json: string; controls?: string };

function copy(base: number | null, blocks: Record<string, BlockSpec> = {}): FileMap {
  const all: Record<string, BlockSpec> = { "wheel/neon": { tsx: neonTsx, json: neonJson }, "result/sheet": { tsx: sheetTsx, json: sheetJson }, ...blocks };
  const files: Record<string, string> = {
    "brainstorm.json": JSON.stringify({
      format: 1,
      session: S,
      base,
      slots: [
        { id: "wheel", title: "The wheel" },
        { id: "result", title: "Result" },
      ],
    }),
    "GUIDE.md": "ignored",
  };
  for (const [id, spec] of Object.entries(all)) {
    files[`slots/${id}/block.tsx`] = spec.tsx;
    files[`slots/${id}/block.json`] = spec.json;
    if (spec.controls !== undefined) files[`slots/${id}/controls.json`] = spec.controls;
  }
  return files;
}

const data = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};

async function setup(clockMs?: () => number, now: () => string = () => AT) {
  const home = mkdtempSync(join(tmpdir(), "bs-service-"));
  const dbPath = join(home, "brainstorm.db");
  const exportsDir = join(home, "exports");
  const bridge = new FakeBridge();
  bridge.add(T1, "proj-a", "Design thread");
  bridge.add(T2, "proj-a", "Takeover thread");
  bridge.add(T3, "proj-b", "Other project");
  const ids = ["s_wheel01", "s_onbrd02", "s_onbrd03"] as SessionId[];
  const open = () => Brainstorm.open({ dbPath, exportsDir, bridge, checker, now, clockMs, newSessionId: () => ids.shift() ?? ("s_spare99" as SessionId) });
  const service = await open();
  return { service, bridge, open, exportsDir };
}

async function withIteration() {
  const ctx = await setup();
  data(await ctx.service.newSession({ title: "Chore wheel", brief: "Pick who does chores", thread: T1, projectPath: "C:\\repo" }));
  data(await ctx.service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: "first cut" }));
  return ctx;
}

const FRAME = { width: 390, height: null };
const SLOTS = [
  { id: "wheel", title: "The wheel", frame: FRAME },
  { id: "result", title: "Result", frame: FRAME },
];

describe("commit", () => {
  test("creates a session attached to the caller, then an iteration that pull round-trips", async () => {
    const { service } = await setup();
    expect(await service.newSession({ title: "Chore wheel", brief: "Pick who does chores", thread: T1, projectPath: "C:\\repo" })).toEqual({
      ok: true,
      data: {
        session: { id: S, projectId: "proj-a", title: "Chore wheel", brief: "Pick who does chores", createdAt: AT },
        attachment: { session: S, threadId: T1, attachedAt: AT, lostAt: null },
      },
    });
    expect(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: "first cut" })).toEqual({
      ok: true,
      data: {
        created: true,
        warnings: [],
        iteration: { n: 1, threadId: T1, note: "first cut", createdAt: AT, slots: SLOTS, blocks: [SHEET, NEON], changed: [SHEET, NEON] },
      },
    });
    const { files: pulled, iteration } = data(await service.pull(S));
    expect(iteration).toBe(1);
    expect(Object.keys(pulled).sort()).toEqual([
      ".gitignore",
      "GUIDE.md",
      "brainstorm.json",
      "slots/result/sheet/block.json",
      "slots/result/sheet/block.tsx",
      "slots/wheel/neon/block.json",
      "slots/wheel/neon/block.tsx",
    ]);
    expect(pulled["slots/wheel/neon/block.tsx"]).toBe(neonTsx);
    expect(JSON.parse(pulled["brainstorm.json"] ?? "")).toEqual({
      format: 1,
      session: S,
      base: 1,
      slots: [
        { id: "wheel", title: "The wheel", frame: { width: 390 } },
        { id: "result", title: "Result", frame: { width: 390 } },
      ],
    });
  });

  test("an unchanged commit is an idempotent replay, even when base was never rewritten", async () => {
    const { service } = await withIteration();
    for (const base of [1, null]) {
      expect(await service.commit({ session: S, thread: T1, files: copy(base), addresses: [], note: "again" })).toEqual({
        ok: true,
        data: {
          created: false,
          warnings: [],
          iteration: { n: 1, threadId: T1, note: "first cut", createdAt: AT, slots: SLOTS, blocks: [SHEET, NEON], changed: [SHEET, NEON] },
        },
      });
    }
  });

  test("a changed copy based on an older iteration is stale", async () => {
    const { service } = await withIteration();
    const edited = (headline: string) => ({ "result/sheet": { tsx: sheetTsx.replace("{headline}", headline), json: sheetJson } });
    expect(data(await service.commit({ session: S, thread: T1, files: copy(1, edited("A")), addresses: [], note: null })).iteration.changed).toEqual([SHEET]);
    expect(await service.commit({ session: S, thread: T1, files: copy(1, edited("B")), addresses: [], note: null })).toEqual({
      ok: false,
      error: {
        code: "stale_working_copy",
        message: "the working copy is based on iteration 1, but iteration 2 is the latest; pull again and reapply your edits",
        base: 1,
        latest: 2,
      },
    });
  });

  test("validation_failed returns parse and check errors together, and saves nothing", async () => {
    const { service } = await withIteration();
    const files = {
      ...copy(1, {
        "wheel/neon": { tsx: "export default function Wheel() { return <div>; }\n", json: neonJson },
        "result/sheet": { tsx: sheetTsx, json: JSON.stringify({ title: "Result sheet", props: { appearance: { headline: { type: "number", label: "H", default: 1, min: 5, max: 2 } } } }) },
      }),
      "slots/wheel/neon/helpers.ts": "export const x = 1;\n",
    };
    const result = await service.commit({ session: S, thread: T1, files, addresses: [], note: null });
    expect(result.ok ? null : result.error).toEqual({
      code: "validation_failed",
      message: "3 errors; nothing was saved",
      issues: [
        {
          severity: "error",
          code: "unexpected_file",
          file: "slots/wheel/neon/helpers.ts",
          loc: null,
          pointer: null,
          message:
            "Brainstorm reads only brainstorm.json, slots/<slot>/<variant>/{block.tsx,block.json,block.css,controls.json} and, with a design system, proposed/<Name>/{component.tsx,component.json,component.css}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.",
        },
        {
          severity: "error",
          code: "invalid_prop",
          file: "slots/result/sheet/block.json",
          loc: null,
          pointer: "/props/appearance/headline/max",
          message: "max (2) must be greater than min (5)",
        },
        {
          severity: "error",
          code: "compile_error",
          file: "slots/wheel/neon/block.tsx",
          loc: { line: 1, column: 48 },
          pointer: null,
          message: "Unexpected token",
        },
      ],
    });
    expect(data(await service.pull(S)).files["slots/wheel/neon/block.tsx"]).toBe(neonTsx);
  });

  test("a commit from a thread that isn't attached names the owner", async () => {
    const { service } = await withIteration();
    data(await service.attach({ ref: "chore wheel", thread: T2 }));
    expect(await service.commit({ session: S, thread: T1, files: copy(1), addresses: [], note: null })).toEqual({
      ok: false,
      error: {
        code: "thread_not_attached",
        message: `session ${S} is attached to thread ${T2}, not ${T1}; run brainstorm session attach ${S} from this thread to take it over`,
        owner: T2,
      },
    });
  });

  test("returns every warning code", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: "spinSeconds" as PropName, value: 2 }));
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: "spin-button" as PartName }, text: "too small" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "blocks", blocks: [NEON] }, freetext: null }));

    const { spinSeconds: _dropped, ...appearance } = wheelProps.appearance;
    const neon = {
      tsx: `export default function Wheel({ people }) {
  return <div>{people.map((p) => <span key={p.name} data-part="slice">{p.name}</span>)}</div>;
}
`,
      json: JSON.stringify({ title: "Neon wheel", props: { data: wheelProps.data, appearance } }),
      controls: JSON.stringify({
        root: "main",
        elements: {
          main: { type: "Section", props: { title: "Look" }, children: ["accent"] },
          accent: { type: "Colour", props: { label: null, value: { $bindState: "/accent" } } },
        },
      }),
    };
    const sheet = { tsx: sheetTsx.replace("<section", "<section className=\"big\""), json: sheetJson };
    const result = data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": neon, "result/sheet": sheet }), addresses: [], note: null }));
    expect(result.warnings.map((w) => [w.code, w.file, w.message])).toEqual([
      ["uncontrolled_prop", "slots/wheel/neon/controls.json", `appearance prop "density" has no control, so Rob can't adjust it`],
      ["uncontrolled_prop", "slots/wheel/neon/controls.json", `appearance prop "showOdds" has no control, so Rob can't adjust it`],
      ["uncontrolled_prop", "slots/wheel/neon/controls.json", `appearance prop "headline" has no control, so Rob can't adjust it`],
      ["duplicate_part", "slots/wheel/neon/block.tsx", 'data-part "slice" appears more than once in one render; pins need each part to be unique'],
      [
        "override_dropped",
        "slots/wheel/neon/block.json",
        "Rob set spinSeconds = 2 on wheel/neon, and it no longer applies (prop_removed); he'll see it flagged",
      ],
      [
        "pin_lost",
        "slots/wheel/neon/block.tsx",
        'feedback #1 ("too small") is pinned to data-part "spin-button" in wheel/neon, which this commit no longer renders',
      ],
      ["out_of_scope", "slots/result/sheet/block.tsx", "result/sheet changed, but request 1 asked only for wheel/neon"],
      [
        "not_addressed",
        null,
        "request 1 asked about feedback #1, and this commit doesn't address it; pass --addresses 1 if it does",
      ],
    ]);
    expect(result.iteration.changed).toEqual([SHEET, NEON]);
  });

  test("--addresses marks feedback addressed and fulfils the open request", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: null }, text: "louder" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "brighter" }));
    const louder = neonTsx.replace("Spin", "SPIN");
    const result = data(
      await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": { tsx: louder, json: neonJson } }), addresses: [1 as FeedbackId], note: null }),
    );
    expect(result.warnings).toEqual([]);
    const view = data(await service.view(S));
    expect(view.feedback.map((f) => [f.id, f.status])).toEqual([[1, { state: "addressed", in: 2 }]]);
    expect(view.request?.message).toBe("Iteration 2 · changed Neon wheel");
    expect(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": { tsx: louder, json: neonJson } }), addresses: [1 as FeedbackId], note: null })).toMatchObject({
      ok: true,
      data: { created: false, iteration: { n: 2 } },
    });
  });
});

describe("Rob's actions", () => {
  test("feedback actions follow its status: an addressed item can't be edited or deleted", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: null }, text: "louder" }));
    data(await service.act(S, { kind: "edit_feedback", id: 1 as FeedbackId, text: "much louder" }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": { tsx: neonTsx.replace("Spin", "SPIN"), json: neonJson } }), addresses: [1 as FeedbackId], note: null }));
    expect(await service.act(S, { kind: "edit_feedback", id: 1 as FeedbackId, text: "quieter" })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "feedback #1 is addressed, so it can't be edited" },
    });
    expect(await service.act(S, { kind: "delete_feedback", id: 1 as FeedbackId })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "feedback #1 is addressed, so it can't be deleted" },
    });
    data(await service.act(S, { kind: "confirm_feedback", id: 1 as FeedbackId }));
    expect(await service.act(S, { kind: "confirm_feedback", id: 1 as FeedbackId })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "feedback #1 is confirmed, so it can't be confirmed" },
    });
    expect(data(await service.view(S)).feedback.map((f) => [f.text, f.status.state])).toEqual([["much louder", "confirmed"]]);
  });

  test("view.regenerate says why Regenerate is blocked, and regenerate refuses the same cases", async () => {
    const { service, bridge } = await setup();
    data(await service.newSession({ title: "Chore wheel", brief: "Pick who does chores", thread: T1, projectPath: null }));
    expect(data(await service.view(S)).regenerate).toEqual({ ok: false, reason: "no_iteration" });
    expect(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "iteration", message: `${S} has no iteration to regenerate yet` },
    });

    data(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));
    expect(data(await service.view(S)).regenerate).toEqual({ ok: true });
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    expect(data(await service.view(S)).regenerate).toEqual({ ok: false, reason: "request_open" });
    data(await service.act(S, { kind: "withdraw_request" }));

    bridge.thread(T1).missing = true;
    await service.act(S, { kind: "check_thread" });
    expect(data(await service.view(S)).regenerate).toEqual({ ok: false, reason: "thread_lost" });
    expect(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null })).toEqual({
      ok: false,
      error: {
        code: "thread_lost",
        message: `thread ${T1} is gone; start a fresh thread for the brainstorm first`,
        thread: T1,
      },
    });
    expect(bridge.sent.length).toBe(1);
  });

  test("a request carries the open feedback in its scope", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: null }, text: "louder" }));
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: SHEET, part: null }, text: "bigger" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "blocks", blocks: [SHEET] }, freetext: null }));
    expect(bridge.sent.map((m) => m.message.split("\n")[0])).toEqual([`[brainstorm] session ${S} · request 1 · scope: result/sheet · feedback: #2`]);
  });
});

const gitRepo = (name: string) => {
  const repo = join(mkdtempSync(join(tmpdir(), "bs-repo-")), name);
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
  return repo;
};

describe("listSessions", () => {
  test("lists each session with its project name, attachment and latest activity", async () => {
    let at = "2026-11-05T10:00:00.000Z";
    const { service } = await setup(undefined, () => at);
    data(await service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: gitRepo("repo") }));
    at = "2026-11-05T11:00:00.000Z";
    data(await service.newSession({ title: "Onboarding", brief: "", thread: T3, projectPath: null }));
    at = "2026-11-05T12:00:00.000Z";
    data(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));
    const listed = async () => data(await service.listSessions(null)).map((s) => [s.id, s.projectId, s.projectName, s.latest, s.lost, s.activeAt, s.request]);
    expect(await listed()).toEqual([
      [S, "proj-a", "repo", 1, false, "2026-11-05T12:00:00.000Z", null],
      ["s_onbrd02", "proj-b", null, null, false, "2026-11-05T11:00:00.000Z", null],
    ]);
    at = "2026-11-05T13:00:00.000Z";
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    expect((await listed())[0]).toEqual([S, "proj-a", "repo", 1, false, "2026-11-05T13:00:00.000Z", "queued"]);
    data(await service.act(S, { kind: "withdraw_request" }));
    expect((await listed())[0]?.[6]).toBe(null);
  });

  test("names a project from its newest session in git, and keeps the name when a later one isn't", async () => {
    const { service } = await setup();
    const names = async () => data(await service.listSessions(null)).map((s) => s.projectName);
    data(await service.newSession({ title: "Loose", brief: "", thread: T1, projectPath: null }));
    expect(await names()).toEqual([null]);
    data(await service.newSession({ title: "Wheel", brief: "", thread: T1, projectPath: gitRepo("brainstorm") }));
    data(await service.newSession({ title: "Notes", brief: "", thread: T2, projectPath: mkdtempSync(join(tmpdir(), "bs-loose-")) }));
    expect(await names()).toEqual(["brainstorm", "brainstorm", "brainstorm"]);
    data(await service.newSession({ title: "Renamed", brief: "", thread: T1, projectPath: gitRepo("brainstorm-app") }));
    expect(await names()).toEqual(["brainstorm-app", "brainstorm-app", "brainstorm-app", "brainstorm-app"]);
  });
});

describe("settle", () => {
  async function clocked() {
    let minute = 0;
    const tick = () => `2026-11-05T10:${String(minute++).padStart(2, "0")}:00.000Z`;
    const ctx = await setup(undefined, tick);
    data(await ctx.service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: null }));
    data(await ctx.service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));
    const settlement = async () => data(await ctx.service.listSessions(null)).find((l) => l.id === S)?.settlement;
    return { ...ctx, settlement };
  }

  test("settling keeps everything, a second settle keeps its time, and un-settling brings it back", async () => {
    const { service, settlement } = await clocked();
    expect(await settlement()).toEqual({ state: "active", unsettledAt: null });
    expect(data(service.settle(S, true)).settlement).toEqual({ state: "settled", at: "2026-11-05T10:02:00.000Z" });
    expect(data(service.settle(S, true)).settlement, "settling again keeps when it was settled").toEqual({ state: "settled", at: "2026-11-05T10:02:00.000Z" });
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.iteration?.blocks.length, Object.keys(data(await service.pull(S)).files).length], "settling is not deleting").toEqual([1, 2, 7]);
    const back = data(service.settle(S, false)).settlement;
    expect(back.state === "active" && back.unsettledAt !== null && back.unsettledAt > "2026-11-05T10:02:00.000Z", "un-settling records when").toBe(true);
    expect(data(service.settle(S, false)).settlement, "un-settling an active brainstorm changes nothing").toEqual(back);
    expect(service.settle("s_nothere1" as SessionId, true)).toEqual({ ok: false, error: { code: "not_found", entity: "session", message: "no session s_nothere1" } });
  });

  test("a regenerate brings a settled brainstorm back, as a new turn brings back a T3 thread", async () => {
    const { service, settlement } = await clocked();
    data(service.settle(S, true));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    expect(await settlement()).toEqual({ state: "active", unsettledAt: null });
  });

  test("an agent commit that no request asked for brings it back", async () => {
    const { service, settlement } = await clocked();
    data(service.settle(S, true));
    const edited = { "wheel/neon": { tsx: neonTsx.replace("Spin", "Go"), json: neonJson } };
    data(await service.commit({ session: S, thread: T1, files: copy(1, edited), addresses: [], note: null }));
    expect(await settlement()).toEqual({ state: "active", unsettledAt: null });
    expect(data(service.settle(S, true)).settlement, "settling again starts a new settle").toEqual({ state: "settled", at: "2026-11-05T10:04:00.000Z" });
  });

  test("a settle during an open request waits for it: the commit that ends it settles, and a failed run keeps it in view", async () => {
    const { service, bridge, settlement } = await clocked();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    data(service.settle(S, true));
    expect(await settlement()).toEqual({ state: "settling", at: "2026-11-05T10:04:00.000Z" });

    bridge.startRun(T1, "run:2");
    bridge.endRun(T1, "failed");
    await service.tick();
    expect(data(await service.listSessions(null))[0]?.request, "the failed run is what the row shows").toBe("run_failed");
    expect(await settlement()).toEqual({ state: "settling", at: "2026-11-05T10:04:00.000Z" });

    data(await service.act(S, { kind: "retry_request" }));
    const edited = { "wheel/neon": { tsx: neonTsx.replace("Spin", "Go"), json: neonJson } };
    data(await service.commit({ session: S, thread: T1, files: copy(1, edited), addresses: [], note: null }));
    expect(await settlement()).toEqual({ state: "settled", at: "2026-11-05T10:04:00.000Z" });
  });

  test("a settle survives a restart", async () => {
    const { service, open } = await clocked();
    data(service.settle(S, true));
    service.close();
    const reopened = await open();
    expect(data(await reopened.listSessions(null))[0]?.settlement).toEqual({ state: "settled", at: "2026-11-05T10:02:00.000Z" });
  });
});

describe("attach", () => {
  test("refuses a thread from another project", async () => {
    const { service } = await withIteration();
    expect(await service.attach({ ref: S, thread: T3 })).toEqual({
      ok: false,
      error: {
        code: "wrong_project",
        message: `session ${S} ("Chore wheel") belongs to project proj-a, but thread ${T3} is in project proj-b`,
        sessionProject: "proj-a",
        threadProject: "proj-b",
      },
    });
  });

  test("resolves an exact title, lists candidates for an ambiguous one, and records the takeover", async () => {
    const { service } = await withIteration();
    data(await service.newSession({ title: "Onboarding A", brief: "", thread: T1, projectPath: null }));
    data(await service.newSession({ title: "Onboarding B", brief: "", thread: T1, projectPath: null }));
    expect(await service.attach({ ref: "onboarding", thread: T2 })).toEqual({
      ok: false,
      error: {
        code: "ambiguous_title",
        message: '"onboarding" matches 2 sessions; attach by id',
        candidates: [
          { id: "s_onbrd02", title: "Onboarding A" },
          { id: "s_onbrd03", title: "Onboarding B" },
        ],
      },
    });
    expect(await service.attach({ ref: "CHORE WHEEL", thread: T2 })).toEqual({
      ok: true,
      data: {
        session: { id: S, projectId: "proj-a", title: "Chore wheel", brief: "Pick who does chores", createdAt: AT },
        attachment: { session: S, threadId: T2, attachedAt: AT, lostAt: null },
        previous: T1,
      },
    });
    expect(data(await service.attach({ ref: "boarding b", thread: T2 })).session.id).toBe("s_onbrd03");
    expect(await service.attach({ ref: "nothing like it", thread: T2 })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "session", message: 'no session has the id or title "nothing like it"' },
    });
  });
});

describe("request phases", () => {
  const phase = async (service: Brainstorm) => {
    const r = data(await service.view(S)).request;
    return r === null ? null : { phase: r.phase.phase, actions: r.phase.actions, message: r.message };
  };

  test("queued, working, asking, run failed, no change, retry and fulfilled", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "make the spin feel less random" }));
    expect(bridge.sent).toEqual([
      {
        thread: T1,
        message: `[brainstorm] session ${S} · request 1 · scope: all · freetext: "make the spin feel less random"\nHandle with the use-brainstorm skill: run \`brainstorm context ${S}\`.`,
      },
    ]);
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });
    const listed = async () => data(await service.listSessions(null)).find((l) => l.id === S)?.request;
    expect(await listed()).toBe("queued");

    bridge.startRun(T1, "run:2");
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "working", actions: ["open_thread", "withdraw"], message: "Agent working" });
    expect(await listed(), "a listing shows the phase the bar does").toBe("working");

    bridge.startRun(T1, "run:2", 1);
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "asking", actions: ["open_thread", "withdraw"], message: "Agent asking in T3" });

    bridge.endRun(T1, "failed");
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "run_failed", actions: ["retry", "open_thread", "withdraw"], message: "The agent's run failed in T3" });
    expect(await listed()).toBe("run_failed");

    bridge.endRun(T1, "completed");
    await service.tick();
    expect(await phase(service)).toEqual({
      phase: "no_change",
      actions: ["retry", "open_thread", "withdraw"],
      message: "The agent replied in T3 without changing the design",
    });

    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.length).toBe(2);
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });

    const edited = { "wheel/neon": { tsx: neonTsx.replace("Spin", "Go"), json: neonJson } };
    data(await service.commit({ session: S, thread: T1, files: copy(1, edited), addresses: [], note: null }));
    expect(await phase(service)).toEqual({ phase: "fulfilled", actions: [], message: "Iteration 2 · changed Neon wheel" });
  });

  test("send failed, and a retry that finds the marker already arrived doesn't send twice", async () => {
    const { service, bridge } = await withIteration();
    bridge.sendMode = "fail";
    data(await service.act(S, { kind: "regenerate", scope: { kind: "described" }, freetext: "fewer colours" }));
    expect(await phase(service)).toEqual({
      phase: "send_failed",
      actions: ["retry", "open_thread", "withdraw"],
      message: "Couldn't send (t3 did not answer within 15 s). The request is saved.",
    });
    expect(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null })).toEqual({
      ok: false,
      error: { code: "request_open", message: "request 1 is still open; withdraw it first", n: 1 },
    });

    bridge.sendMode = "deliver_then_fail";
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.length).toBe(1);
    bridge.sendMode = "deliver";
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.length).toBe(1);
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });

    data(await service.act(S, { kind: "withdraw_request" }));
    expect(await phase(service)).toEqual({ phase: "withdrawn", actions: [], message: "Request withdrawn" });
  });

  test("previous thread after a takeover, and resend goes to the new thread", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    data(await service.attach({ ref: S, thread: T2 }));
    expect(await phase(service)).toEqual({ phase: "previous_thread", actions: ["resend", "open_thread", "withdraw"], message: "Sent to the previous thread" });
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.map((s) => s.thread)).toEqual([T1, T2]);
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });
  });

  test("a missing thread loses the attachment, and seeing it again recovers", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    bridge.thread(T1).missing = true;
    await service.tick();
    expect(data(await service.view(S)).attachment.lostAt).toBe(AT);
    expect(await phase(service)).toEqual({
      phase: "thread_lost",
      actions: ["fresh_thread", "withdraw"],
      message: "This brainstorm's thread is gone. Start a fresh thread, and the open request goes to it.",
    });
    bridge.thread(T1).missing = false;
    await service.tick();
    expect(data(await service.view(S)).attachment.lostAt).toBe(null);
  });

  test("a fresh thread is the way on from a lost one, and the open request goes to it", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" }));
    expect(await service.act(S, { kind: "refresh_thread" }), "a working thread keeps its request").toMatchObject({ ok: false, error: { code: "request_open" } });
    bridge.thread(T1).missing = true;
    await service.tick();
    data(await service.act(S, { kind: "refresh_thread" }));
    const fresh = bridge.started[0]!.thread;
    expect(data(await service.view(S)).attachment).toMatchObject({ threadId: fresh, lostAt: null });
    expect(bridge.sent.map((m) => [m.thread, m.message.split("\n")[0]])).toEqual([
      [T1, `[brainstorm] session ${S} · request 1 · scope: all · freetext: "again"`],
      [fresh, `[brainstorm] session ${S} · request 1 · scope: all · freetext: "again"`],
    ]);
    expect(data(await service.view(S)).request?.request).toMatchObject({ n: 1, threadId: fresh, state: { state: "sent" } });
  });

  test("sending, and startup reconciliation of a send that never finished", async () => {
    const { service, bridge, open } = await withIteration();
    bridge.sendMode = "hang";
    const pending = service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null });
    expect(await phase(service)).toEqual({ phase: "sending", actions: [], message: "Sending to T3" });

    const restarted = await open();
    expect(await phase(restarted)).toEqual({
      phase: "send_failed",
      actions: ["retry", "open_thread", "withdraw"],
      message: "Couldn't send (Brainstorm stopped before the send finished). The request is saved.",
    });
    bridge.release();
    await pending;
    restarted.close();
  });

  test("startup reconciliation marks a send that arrived as sent", async () => {
    const { service, bridge, open } = await withIteration();
    bridge.sendMode = "hang";
    const pending = service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null });
    await Promise.resolve();
    bridge.thread(T1).messages.push({ role: "user", runId: null, text: `[brainstorm] session ${S} · request 1 · scope: all` });
    const restarted = await open();
    expect(await phase(restarted)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });
    bridge.release();
    await pending;
    restarted.close();
  });
});

describe("view and T3", () => {
  test("view() asks T3 about an unreachable thread at most once per 10 s", async () => {
    let clock = 0;
    const { service, bridge, open } = await setup(() => clock);
    data(await service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: null }));
    bridge.snapshotFails = true;
    const restarted = await open();
    const calls = bridge.snapshotCalls;
    expect(data(await restarted.view(S)).thread).toBe(null);
    clock = 9_999;
    data(await restarted.view(S));
    data(await restarted.view(S));
    expect(bridge.snapshotCalls - calls).toBe(1);

    bridge.snapshotFails = false;
    clock = 10_000;
    expect(data(await restarted.view(S)).thread?.title).toBe("Design thread");
    clock = 60_000;
    data(await restarted.view(S));
    expect(bridge.snapshotCalls - calls).toBe(2);
    restarted.close();
  });

  test("a failed check keeps the thread Rob already sees", async () => {
    const { service, bridge } = await withIteration();
    expect(data(await service.view(S)).thread?.title).toBe("Design thread");
    bridge.snapshotFails = true;
    data(await service.act(S, { kind: "check_thread" }));
    expect(data(await service.view(S)).thread?.title).toBe("Design thread");
  });
});

describe("overrides on read", () => {
  test("an override survives, goes inapplicable when its prop is removed, and applies again when the prop returns", async () => {
    const { service } = await withIteration();
    const accent = { blockId: NEON, prop: "accent" as PropName, value: "#00ff00", setAt: AT };
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: accent.prop, value: "#00ff00" }));
    const effective = async () => {
      const view = data(await service.view(S));
      return {
        applicable: view.overrides.applicable,
        inapplicable: view.overrides.inapplicable,
        accent: view.iteration?.blocks.find((b) => b.id === NEON)?.effectiveProps.accent,
      };
    };
    expect(await effective()).toEqual({ applicable: [accent], inapplicable: [], accent: "#00ff00" });

    const { accent: _removed, ...appearance } = wheelProps.appearance;
    const withoutAccent = { tsx: neonTsx, json: JSON.stringify({ title: "Neon wheel", props: { data: wheelProps.data, appearance } }) };
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": withoutAccent }), addresses: [], note: null }));
    expect(await effective()).toEqual({ applicable: [], inapplicable: [{ override: accent, reason: "prop_removed" }], accent: undefined });

    data(await service.commit({ session: S, thread: T1, files: copy(2), addresses: [], note: null }));
    expect(await effective()).toEqual({ applicable: [accent], inapplicable: [], accent: "#00ff00" });
  });

  test("Rob's writes are checked against the prop", async () => {
    const { service } = await withIteration();
    expect(await service.act(S, { kind: "set_override", blockId: NEON, prop: "spinSeconds" as PropName, value: 9 })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "9 doesn't fit spinSeconds (out_of_range)" },
    });
  });
});

describe("context", () => {
  test("reports the open request and ends with the exact next commands", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: "spin-button" as PartName }, text: "too small" }));
    data(await service.act(S, { kind: "set_override", blockId: SHEET, prop: "headline" as PropName, value: "Roz" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "blocks", blocks: [NEON] }, freetext: "bigger button" }));
    const context = data(await service.context(S, T2));
    expect({ ...context, controlVocabulary: undefined, latest: context.latest?.n }).toEqual({
      session: { id: S, title: "Chore wheel", brief: "Pick who does chores" },
      fork: null,
      latest: 1 as IterationN,
      attached: false,
      attachedThread: T1,
      request: {
        scope: { kind: "blocks", blocks: [NEON] },
        freetext: "bigger button",
        n: 1,
        base: 1,
        feedback: [
          {
            id: 1,
            pin: { blockId: NEON, part: "spin-button" },
            text: "too small",
            createdIn: 1,
            createdAt: AT,
            history: [],
            status: { state: "open", previouslyAddressedIn: null },
          },
        ],
        overrides: [],
      },
      feedback: {
        open: [
          {
            id: 1,
            pin: { blockId: NEON, part: "spin-button" },
            text: "too small",
            createdIn: 1,
            createdAt: AT,
            history: [],
            status: { state: "open", previouslyAddressedIn: null },
          },
        ],
        addressed: [],
      },
      marks: { mains: {}, grafts: [], trashed: [] },
      controlVocabulary: undefined,
      system: null,
      next: [`brainstorm session attach ${S}`, `brainstorm pull ${S}`, `brainstorm validate ${S}`, `brainstorm commit ${S} --addresses 1`],
    });
  });
});

describe("preview", () => {
  test("is the first slot's selected variant with Rob's settings, and nothing before the first iteration", async () => {
    const { service } = await setup();
    data(await service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: null }));
    expect(service.preview(S)).toEqual({ ok: true, data: null });
    data(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));
    const reelJson = JSON.stringify({ title: "Slot reel", props: { appearance: { headline: { type: "text", label: "Headline", default: "Pull" } } } });
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/reel": { tsx: sheetTsx, json: reelJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "select_variant", slot: "wheel" as SlotId, variant: "reel" as VariantKey }));
    data(await service.act(S, { kind: "set_override", blockId: "wheel/reel" as BlockId, prop: "headline" as PropName, value: "Spin it" }));
    const preview = data(service.preview(S));
    const view = data(await service.view(S));
    const reel = view.iteration?.blocks.find((b) => b.id === "wheel/reel");
    expect(preview).toEqual({
      frame: { slot: "wheel", title: "The wheel", frame: FRAME, blockId: "wheel/reel" },
      module: { blockId: "wheel/reel", hash: reel?.hash, compiled: reel?.compiled, css: reel?.css },
      props: { headline: "Spin it" },
      system: null,
    });
    expect(service.preview("s_nothere1" as SessionId).ok).toBe(false);
  });
});

describe("exportHtml", () => {
  test("writes the latest iteration with every variant, Rob's choices and overrides, named by title, iteration and time", async () => {
    const { service, exportsDir } = await withIteration();
    const reelJson = JSON.stringify({ title: "Slot reel", props: { appearance: { headline: { type: "text", label: "Headline", default: "Pull" } } } });
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/reel": { tsx: sheetTsx, json: reelJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "select_variant", slot: "wheel" as SlotId, variant: "reel" as VariantKey }));
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: "accent" as PropName, value: "#00ff00" }));

    const tz = process.env.TZ;
    process.env.TZ = "UTC";
    const result = await service.exportHtml(S);
    process.env.TZ = tz;
    const file = "Chore wheel-i2-20261105-100000.html";
    expect(result).toEqual({ ok: true, data: { path: join(exportsDir, file), file } });

    const html = readFileSync(join(exportsDir, file), "utf8");
    const boot = JSON.parse(/<script type="application\/json" id="brainstorm-boot">(.*?)<\/script>/s.exec(html)?.[1] ?? "null");
    const [modules, variants, state] = boot.messages;
    expect(boot.mode).toBe("export");
    expect(modules.modules.map((m: { blockId: string }) => m.blockId)).toEqual(["result/sheet", "wheel/neon", "wheel/reel"]);
    expect(variants).toEqual({
      kind: "variants",
      slots: {
        wheel: [
          { blockId: "wheel/neon", title: "Neon wheel" },
          { blockId: "wheel/reel", title: "Slot reel" },
        ],
        result: [{ blockId: "result/sheet", title: "Result sheet" }],
      },
    });
    expect(state).toEqual({
      kind: "state",
      frames: [
        { slot: "wheel", title: "The wheel", frame: FRAME, blockId: "wheel/reel" },
        { slot: "result", title: "Result", frame: FRAME, blockId: "result/sheet" },
      ],
      props: {
        "result/sheet": { headline: "Kai" },
        "wheel/neon": { people: [{ name: "Kai" }, { name: "Roz" }], spinSeconds: 1.5, accent: "#00ff00", density: "roomy", showOdds: true, headline: "Who's up?" },
        "wheel/reel": { headline: "Pull" },
      },
      selected: null,
      stage: null,
    });
  });

  test("a session with no iteration has nothing to export", async () => {
    const { service } = await setup();
    data(await service.newSession({ title: "Empty", brief: "", thread: T1, projectPath: null }));
    expect(await service.exportHtml(S)).toEqual({
      ok: false,
      error: { code: "not_found", entity: "iteration", message: "s_wheel01 has no iteration to export yet" },
    });
  });
});

const F = "s_onbrd02" as SessionId;
const G = "s_onbrd03" as SessionId;
const CALM = "wheel/calm" as BlockId;
const calmJson = JSON.stringify({ title: "Calm wheel", props: wheelProps });

/** Iteration 2 has two wheels; Rob tuned and pinned both, and picked Calm. */
async function withTwoWheels() {
  const ctx = await withIteration();
  data(await ctx.service.commit({ session: S, thread: T1, files: copy(1, { "wheel/calm": { tsx: neonTsx, json: calmJson } }), addresses: [], note: "a calmer one" }));
  data(await ctx.service.act(S, { kind: "set_override", blockId: NEON, prop: "accent" as PropName, value: "#00ff88" }));
  data(await ctx.service.act(S, { kind: "set_override", blockId: NEON, prop: "density" as PropName, value: "roomy" }));
  data(await ctx.service.act(S, { kind: "set_override", blockId: CALM, prop: "spinSeconds" as PropName, value: 3 }));
  data(await ctx.service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: "spin-button" as PartName }, text: "bigger button" }));
  data(await ctx.service.act(S, { kind: "add_feedback", pin: { blockId: CALM, part: null }, text: "too grey" }));
  data(await ctx.service.act(S, { kind: "add_feedback", pin: { blockId: SHEET, part: null }, text: "say who's next" }));
  data(await ctx.service.act(S, { kind: "select_variant", slot: "wheel" as SlotId, variant: "calm" as VariantKey }));
  return ctx;
}

const phaseOf = async (service: Brainstorm, id: SessionId) => {
  const r = data(await service.view(id)).request;
  return r === null ? null : { phase: r.phase.phase, actions: r.phase.actions, message: r.message };
};

const NONE: Marks = { mains: {}, grafts: [], trashed: [] };
const KEEP_NEON: Marks = { ...NONE, mains: { ["wheel" as SlotId]: "neon" as VariantKey } };
const SPIN = "spin-button" as PartName;

/** Iteration 3 changes only the result sheet, so iteration 2, with both wheels, is in the past. */
async function withPastTwoWheels() {
  const ctx = await withTwoWheels();
  const big = { tsx: sheetTsx.replace("<section", '<section className="big"'), json: sheetJson };
  data(await ctx.service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": { tsx: neonTsx, json: calmJson }, "result/sheet": big }), addresses: [], note: "bigger sheet" }));
  return ctx;
}

describe("marks and confirm", () => {
  test("👍 makes a variant Main and shows it, a second 👍 undoes it, and Main is never trashed", async () => {
    const { service } = await withTwoWheels();
    const marks = async () => data(await service.view(S)).marks;
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    expect(await marks()).toEqual({ mains: { wheel: "neon" }, grafts: [], trashed: [] });
    expect(data(await service.view(S)).iteration?.slots[0]?.active, "Main is what shows").toBe("neon");
    expect(await service.act(S, { kind: "trash", blockId: NEON })).toEqual({ ok: false, error: { code: "invalid_action", message: "Main can't be trashed" } });
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    expect(await marks()).toEqual(NONE);

    data(await service.act(S, { kind: "trash", blockId: NEON }));
    expect((await marks()).trashed).toEqual([NEON]);
    expect(await service.act(S, { kind: "trash", blockId: CALM }), "the one left showing is Main").toEqual({
      ok: false,
      error: { code: "invalid_action", message: "Main can't be trashed" },
    });
    data(await service.act(S, { kind: "restore", blockId: NEON }));
    expect(await marks()).toEqual(NONE);
    expect(await service.act(S, { kind: "approve", blockId: "wheel/gone" as BlockId })).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("a confirm with nothing to graft writes the narrowed iteration itself, sends nothing, and clears the marks", async () => {
    const { service, bridge } = await withTwoWheels();
    expect(await service.act(S, { kind: "confirm" })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "there is nothing to confirm: choose a Main, trash a variant or pick an element first" },
    });
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    const sent = bridge.sent.length;
    data(await service.act(S, { kind: "confirm" }));
    const view = data(await service.view(S));
    expect(view.iteration?.n).toBe(3);
    expect(view.iteration?.slots.map((s) => [s.id, s.variants])).toEqual([
      ["wheel", ["neon"]],
      ["result", ["sheet"]],
    ]);
    expect(view.marks).toEqual(NONE);
    expect(view.request?.phase.phase).toBe("fulfilled");
    const origin = view.history.iterations.at(-1)?.origin;
    expect(origin?.kind === "request" && origin.body.scope).toEqual({ kind: "confirm", mains: [{ slot: "wheel", variant: "neon" }], grafts: [], drop: [CALM] });
    expect(bridge.sent.length, "no agent turn").toBe(sent);
  });

  test("a pick goes to the agent with the confirm, the marks hold while it is open, and the agent's commit is checked against it", async () => {
    const { service, bridge } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: "wheel" as SlotId, instruction: "under the wheel" }));
    data(await service.act(S, { kind: "confirm" }));
    expect(bridge.sent.at(-1)?.thread).toBe(T1);
    expect(data(await service.view(S)).request?.request.scope).toEqual({
      kind: "confirm",
      mains: [{ slot: "wheel", variant: "neon" }],
      grafts: [{ from: { blockId: CALM, part: SPIN }, into: "wheel", instruction: "under the wheel" }],
      drop: [CALM],
    });
    expect(await service.act(S, { kind: "trash", blockId: SHEET })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "a confirm is open; its marks change once it lands or you withdraw it" },
    });
    const context = data(await service.context(S, T1));
    expect(context.marks.grafts.map((g) => g.from)).toEqual([{ blockId: CALM, part: SPIN }]);

    const result = data(await service.commit({ session: S, thread: T1, files: copy(2), addresses: [], note: "spin button from Calm" }));
    expect(result.warnings).toEqual([]);
    expect(data(await service.view(S)).marks, "the marks are spent once the confirm lands").toEqual(NONE);

    const other = await withTwoWheels();
    data(await other.service.act(S, { kind: "approve", blockId: NEON }));
    data(await other.service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: "wheel" as SlotId, instruction: null }));
    data(await other.service.act(S, { kind: "confirm" }));
    const noSpin = neonTsx.replace('<button data-part="spin-button">Spin</button>', "");
    const bad = copy(2, { "wheel/neon": { tsx: noSpin, json: neonJson }, "wheel/calm": { tsx: neonTsx, json: calmJson } });
    const warned = data(await other.service.commit({ session: S, thread: T1, files: bad, addresses: [], note: null }));
    expect(warned.warnings.map((w) => [w.code, w.message])).toEqual([
      ["pin_lost", 'feedback #1 ("bigger button") is pinned to data-part "spin-button" in wheel/neon, which this commit no longer renders'],
      ["confirm_mismatch", "request 1 drops wheel/calm, and this commit still has it"],
      ["confirm_mismatch", 'wheel/neon doesn\'t render data-part "spin-button", the element request 1 grafts into it from wheel/calm'],
    ]);
  });

  test("a pick into a slot with no Main makes the variant that shows its Main", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "add_graft", from: { blockId: NEON, part: SPIN }, into: "wheel" as SlotId, instruction: null }));
    const marks = data(await service.view(S)).marks;
    expect(marks.mains).toEqual({ wheel: "calm" });
    expect(marks.grafts.map((g) => [g.from.blockId, g.into])).toEqual([[NEON, "wheel"]]);
    expect(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: null }, into: "wheel" as SlotId, instruction: null })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "that element is already in Main" },
    });
  });

  test("add slot asks the agent for a new slot, and warns when the commit adds none", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "add_slot", prompt: "The empty state" }));
    expect(data(await service.view(S)).request?.request).toMatchObject({ scope: { kind: "add_slot" }, freetext: "The empty state" });
    const big = { tsx: sheetTsx.replace("<section", '<section className="big"'), json: sheetJson };
    const result = data(await service.commit({ session: S, thread: T1, files: copy(1, { "result/sheet": big }), addresses: [], note: null }));
    expect(result.warnings.map((w) => w.code)).toEqual(["out_of_scope", "not_addressed"]);

    const other = await withIteration();
    data(await other.service.act(S, { kind: "add_slot", prompt: "The empty state" }));
    const drawn = copy(1, { "empty/plain": { tsx: sheetTsx, json: JSON.stringify({ title: "Plain empty", props: { appearance: {} } }) } });
    const manifest = JSON.parse(drawn["brainstorm.json"]!) as { slots: unknown[] };
    const files = { ...drawn, "brainstorm.json": JSON.stringify({ ...manifest, slots: [...manifest.slots, { id: "empty", title: "Empty state" }] }) };
    expect(data(await other.service.commit({ session: S, thread: T1, files, addresses: [], note: null })).warnings).toEqual([]);
  });
});

describe("branches", () => {
  test("a confirm on a past iteration makes a branch on the same thread that numbers on from there", async () => {
    const { service, bridge } = await withPastTwoWheels();
    const result = await service.fork(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null });
    expect(result).toEqual({ ok: true, data: { fork: F } });

    const view = data(await service.view(F));
    expect(view.session).toMatchObject({ id: F, title: "Branch from iteration 2", brief: "Pick who does chores" });
    expect(view.tree).toEqual({ root: { id: S, title: "Chore wheel" }, primary: S });
    expect(view.fork).toEqual({ parent: { id: S, title: "Chore wheel" }, from: 2 });
    expect(view.attachment.threadId, "every branch shares the brainstorm's thread").toBe(T1);
    expect(view.iteration?.n).toBe(3);
    expect(view.iteration?.slots.map((s) => [s.id, s.variants, s.active])).toEqual([
      ["wheel", ["neon"], "neon"],
      ["result", ["sheet"], "sheet"],
    ]);
    expect(view.history.iterations.map((e) => [e.session, e.n, e.origin.kind])).toEqual([
      [S, 1, "brief"],
      [S, 2, "agent"],
      [F, 3, "fork"],
    ]);
    const neon = view.iteration?.blocks.find((b) => b.id === NEON);
    expect(neon?.props.appearance.find((p) => p.name === "accent")?.default, "a setting Rob changed is the branch's default").toBe("#00ff88");
    expect(view.overrides.applicable).toEqual([]);
    expect(view.feedback.map((f) => [f.pin.blockId, f.text])).toEqual([
      [NEON, "bigger button"],
      [SHEET, "say who's next"],
    ]);
    expect(view.request, "keeping a Main needs no agent").toBe(null);
    expect(bridge.started).toEqual([]);

    expect(data(await service.view(S)).history.forks).toEqual([{ id: F, title: "Branch from iteration 2", parent: S, from: 2 }]);
    expect(data(await service.listSessions(null)).map((l) => [l.id, l.title]), "home shows one row per brainstorm").toEqual([[S, "Chore wheel"]]);
  });

  test("an instruction goes to the agent on the shared thread, and the brainstorm has one open request at a time", async () => {
    const { service, bridge } = await withPastTwoWheels();
    data(await service.fork(S, { from: 2 as IterationN, marks: NONE, instruction: "Try it as a slot machine" }));
    expect(bridge.sent.at(-1)?.thread).toBe(T1);
    expect(bridge.sent.at(-1)?.message.split("\n")[0]).toBe(
      `[brainstorm] session ${F} · request 1 · branch of ${S} iteration 2 · scope: all · feedback: #1 #2 #3 · freetext: "Try it as a slot machine"`,
    );
    expect(data(await service.view(F)).session.title).toBe("Try it as a slot machine");
    expect(data(await service.view(S)).regenerate).toEqual({ ok: false, reason: "branch_busy" });
    expect(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" })).toMatchObject({ ok: false, error: { code: "request_open" } });
    expect(await service.fork(S, { from: 1 as IterationN, marks: NONE, instruction: "and another" })).toMatchObject({ ok: false, error: { code: "request_open" } });
  });

  test("refuses an iteration or a mark that isn't there, and a branch with nothing to try, and writes nothing", async () => {
    const { service, bridge } = await withPastTwoWheels();
    expect(await service.fork(S, { from: 9 as IterationN, marks: NONE, instruction: "x" })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "iteration", message: `${S} has no iteration 9` },
    });
    expect(await service.fork(S, { from: 1 as IterationN, marks: { ...NONE, mains: { ["wheel" as SlotId]: "calm" as VariantKey } }, instruction: null })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "block", message: "wheel/calm is not in iteration 1" },
    });
    expect(await service.fork(S, { from: 2 as IterationN, marks: NONE, instruction: null })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "say what the branch should try, or mark what it keeps" },
    });
    expect(bridge.sent.length).toBe(0);
    expect(data(await service.view(S)).history.forks).toEqual([]);
  });

  test("a variant that doesn't render with Rob's settings baked in refuses the branch", async () => {
    const { service } = await withIteration();
    const fussy = neonTsx.replace("return (", 'if (accent === "#000000") throw new Error("no black");\n  return (');
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": { tsx: fussy, json: neonJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: "accent" as PropName, value: "#000000" }));
    const result = await service.fork(S, { from: 2 as IterationN, marks: NONE, instruction: "darker" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^Neon wheel doesn't render with your settings as its defaults \(.*no black.*\)\. Reset the setting that breaks it, or keep another variant\.$/);
    expect(data(await service.view(S)).history.forks).toEqual([]);
  });

  test("make primary puts a branch on the home row, and the old main line becomes an offshoot", async () => {
    const { service } = await withPastTwoWheels();
    data(await service.fork(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null }));
    data(await service.act(F, { kind: "make_primary" }));
    expect(data(await service.view(S)).tree.primary).toBe(F);
    expect(data(await service.listSessions(null)).map((l) => [l.id, l.title, l.latest])).toEqual([[F, "Chore wheel", 3]]);
  });

  test("a fresh thread moves every branch to it, and names the app's home when it isn't the default", async () => {
    const home = mkdtempSync(join(tmpdir(), "bs-service-"));
    const bridge = new FakeBridge();
    bridge.add(T1, "proj-a", "Design thread");
    const ids = [S, F] as SessionId[];
    const service = await Brainstorm.open({
      dbPath: join(home, "brainstorm.db"),
      exportsDir: join(home, "exports"),
      bridge,
      checker,
      now: () => AT,
      newSessionId: () => ids.shift()!,
      agentHome: "C:\\bs-home",
    });
    data(await service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "result/sheet": { tsx: sheetTsx.replace("<section", "<section hidden"), json: sheetJson } }), addresses: [], note: null }));
    data(await service.fork(S, { from: 1 as IterationN, marks: NONE, instruction: "x" }));
    data(await service.act(F, { kind: "withdraw_request" }));

    data(await service.act(F, { kind: "refresh_thread" }));
    const fresh = bridge.started[0]!;
    expect(fresh.title).toBe("Chore wheel");
    expect(fresh.message.split("\n")).toEqual([
      `[brainstorm] session ${F} · fresh thread for "Chore wheel"`,
      `Handle with the use-brainstorm skill: this thread is new, so run \`brainstorm session attach ${F}\`, then \`brainstorm context ${F}\`, and reply in one line once you have read it.`,
      "Brainstorm runs with BRAINSTORM_HOME=C:\\bs-home. Set it on every brainstorm command: in PowerShell, start each with `$env:BRAINSTORM_HOME = 'C:\\bs-home';`; in a POSIX shell, with `BRAINSTORM_HOME='C:\\bs-home'`.",
    ]);
    expect(data(await service.view(S)).attachment.threadId).toBe(fresh.thread);
    expect(data(await service.view(F)).attachment.threadId).toBe(fresh.thread);
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    expect(bridge.sent.at(-1)!.thread).toBe(fresh.thread);
    expect(bridge.sent.at(-1)!.message.split("\n"), "a request message never names the home").toHaveLength(2);
    service.close();
  });
});

describe("vary", () => {
  const spinTsx = (label: string) => `export default function Spin() {
  return <button data-part="spin-button">${label}</button>;
}
`;
  const spinJson = (title: string) => JSON.stringify({ title, props: { appearance: {} } });

  test("sends a scoped request named after the element, and the new variants land marked new until seen", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: null }, text: "louder" }));
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: "spin-button" as PartName }, count: 3, direction: "bouncier" }));
    expect(bridge.sent.map((m) => m.message.split("\n")[0])).toEqual([
      `[brainstorm] session ${S} · request 1 · scope: vary wheel/neon [spin-button] as spin-button-a, spin-button-b, spin-button-c · freetext: "bouncier"`,
    ]);
    const open = data(await service.view(S)).request?.request;
    expect(open?.scope).toEqual({
      kind: "vary",
      target: { blockId: NEON, part: "spin-button" },
      variants: [
        { key: "spin-button-a", title: "Spin button A" },
        { key: "spin-button-b", title: "Spin button B" },
        { key: "spin-button-c", title: "Spin button C" },
      ],
    });
    expect(open?.feedbackIds, "a vary carries no feedback").toEqual([]);

    const added = Object.fromEntries(["a", "b", "c"].map((l) => [`wheel/spin-button-${l}`, { tsx: spinTsx(l), json: spinJson(`Spin button ${l.toUpperCase()}`) }]));
    const result = data(await service.commit({ session: S, thread: T1, files: copy(1, added), addresses: [], note: null }));
    expect(result.warnings).toEqual([]);
    const blocks = () => service.view(S).then((v) => data(v).iteration?.blocks.map((b) => [b.id, b.isNew]));
    expect(await blocks()).toEqual([
      [SHEET, false],
      [NEON, false],
      ["wheel/spin-button-a", true],
      ["wheel/spin-button-b", true],
      ["wheel/spin-button-c", true],
    ]);
    data(await service.act(S, { kind: "mark_seen", blocks: ["wheel/spin-button-a" as BlockId] }));
    expect((await blocks())?.filter(([, isNew]) => isNew).map(([id]) => id)).toEqual(["wheel/spin-button-b", "wheel/spin-button-c"]);
    expect(data(await service.view(S)).request?.message).toBe("Iteration 2 · 3 new variants of Spin button");

    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: "spin-button" as PartName }, count: 2, direction: null }));
    const again = data(await service.view(S)).request?.request.scope;
    expect(again?.kind === "vary" && again.variants.map((v) => v.key), "a second vary goes on to the next letters").toEqual(["spin-button-d", "spin-button-e"]);
  });

  test("once a slot has a Main, a 👍 on a vary option brings its element into Main, and a second takes it out", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: "spin-button" as PartName }, count: 1, direction: null }));
    const files = copy(1, { "wheel/spin-button-a": { tsx: spinTsx("a"), json: spinJson("Spin button A") } });
    data(await service.commit({ session: S, thread: T1, files, addresses: [], note: null }));
    const option = "wheel/spin-button-a" as BlockId;
    expect(data(await service.view(S)).iteration?.blocks.find((b) => b.id === option)?.variedFrom).toEqual({ blockId: NEON, part: "spin-button" });

    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "approve", blockId: option }));
    const marks = data(await service.view(S)).marks;
    expect(marks.mains).toEqual({ wheel: "neon" });
    expect(marks.grafts.map(({ from, into, instruction }) => ({ from, into, instruction }))).toEqual([{ from: { blockId: option, part: "spin-button" }, into: "wheel", instruction: null }]);
    data(await service.act(S, { kind: "approve", blockId: option }));
    expect(data(await service.view(S)).marks.grafts).toEqual([]);
  });

  test("a whole-block vary is named after the block, and the count is held to 1 to 6", async () => {
    const { service } = await withIteration();
    expect(await service.act(S, { kind: "vary", target: { blockId: NEON, part: null }, count: 7, direction: null })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "vary asks for 1 to 6 variants" },
    });
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: null }, count: 2, direction: null }));
    const scope = data(await service.view(S)).request?.request.scope;
    expect(scope?.kind === "vary" && scope.variants).toEqual([
      { key: "neon-a", title: "Neon wheel A" },
      { key: "neon-b", title: "Neon wheel B" },
    ]);
  });

  test("warns when the commit isn't the variants asked for", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: "spin-button" as PartName }, count: 3, direction: null }));
    const files = copy(1, {
      "wheel/spin-button-a": { tsx: spinTsx("a"), json: spinJson("Spin button A") },
      "wheel/spin-button-b": { tsx: sheetTsx, json: spinJson("Bouncy") },
      "result/sheet": { tsx: sheetTsx.replace("<section", '<section className="big"'), json: sheetJson },
    });
    const result = data(await service.commit({ session: S, thread: T1, files, addresses: [], note: null }));
    expect(result.warnings.map((w) => [w.code, w.file, w.message])).toEqual([
      [
        "out_of_scope",
        "slots/result/sheet/block.tsx",
        "result/sheet changed, but request 1 asked only for new variants of wheel/neon: wheel/spin-button-a, wheel/spin-button-b, wheel/spin-button-c",
      ],
      ["vary_mismatch", "slots/wheel/spin-button-b/block.json", 'wheel/spin-button-b is titled "Bouncy"; request 1 named it "Spin button B"'],
      ["vary_mismatch", "slots/wheel/spin-button-b/block.tsx", 'wheel/spin-button-b doesn\'t render data-part "spin-button", the element request 1 asked to vary'],
      ["vary_mismatch", "brainstorm.json", 'request 1 asked for wheel/spin-button-c titled "Spin button C", and this commit has no such block'],
    ]);
  });

  test("context spells out the vary, and the target's settings are in scope", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: "accent" as PropName, value: "#00ff88" }));
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: "spin-button" as PartName }, count: 1, direction: null }));
    const context = data(await service.context(S, T1));
    expect(context.request?.overrides.map((o) => [o.blockId, o.prop, o.value])).toEqual([[NEON, "accent", "#00ff88"]]);
  });
});

describe("history", () => {
  test("names where each iteration came from, and a past iteration reads as it was", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "calmer" }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/calm": { tsx: neonTsx, json: calmJson } }), addresses: [], note: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": { tsx: neonTsx.replace("Spin", "Go"), json: calmJson } }), addresses: [], note: "tidied" }));
    expect(data(await service.view(S)).history.iterations.map((i) => [i.n, i.origin])).toEqual([
      [1, { kind: "brief" }],
      [2, { kind: "request", n: 1, body: { scope: { kind: "all" }, freetext: "calmer" }, changed: [] }],
      [3, { kind: "agent", note: "tidied" }],
    ]);
    const past = data(service.iteration(S, 1 as IterationN));
    expect(past.n).toBe(1);
    expect(past.blocks.map((b) => [b.id, b.isNew])).toEqual([
      [SHEET, false],
      [NEON, false],
    ]);
    expect(service.iteration(S, 9 as IterationN)).toEqual({ ok: false, error: { code: "not_found", entity: "iteration", message: `${S} has no iteration 9` } });
    const still = data(service.preview(S, { n: 1 as IterationN, slot: "result" as SlotId }));
    expect(still?.frame.blockId).toBe(SHEET);
    expect(data(service.preview(S, { n: 2 as IterationN }))?.frame.blockId).toBe(CALM);
  });

  test("a request sent without words is named by the blocks its iteration changed", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": { tsx: neonTsx.replace("Spin", "Go"), json: neonJson } }), addresses: [], note: null }));
    expect(data(await service.view(S)).history.iterations.map((i) => i.origin)[1]).toEqual({ kind: "request", n: 1, body: { scope: { kind: "all" }, freetext: null }, changed: ["Neon wheel"] });
  });
});
