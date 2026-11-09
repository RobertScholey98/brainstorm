import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker, type Checker } from "../src/core/check";
import { approval } from "../src/core/main";
import type { BlockId, FeedbackId, GraftId, FileMap, IterationN, Marks, PartName, PropName, Result, SessionId, SlotId, ThreadId, VariantKey } from "../src/core/types";
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

async function setup(clockMs?: () => number, now: () => string = () => AT, check: Checker = checker) {
  const home = mkdtempSync(join(tmpdir(), "bs-service-"));
  const dbPath = join(home, "brainstorm.db");
  const exportsDir = join(home, "exports");
  const bridge = new FakeBridge();
  bridge.add(T1, "proj-a", "Design thread");
  bridge.add(T2, "proj-a", "Takeover thread");
  bridge.add(T3, "proj-b", "Other project");
  const ids = ["s_wheel01", "s_onbrd02", "s_onbrd03"] as SessionId[];
  const open = () => Brainstorm.open({ dbPath, exportsDir, bridge, checker: check, now, clockMs, newSessionId: () => ids.shift() ?? ("s_spare99" as SessionId) });
  const service = await open();
  return { service, bridge, open, exportsDir, dbPath };
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
        system: null,
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

  test("the settle is the tree's: Make primary keeps it, and work on a branch that isn't primary brings it back", async () => {
    const { service } = await clocked();
    data(await service.branch(S, { from: 1 as IterationN, marks: { mains: {}, grafts: [], trashed: [] }, instruction: "Try a slot machine" }));
    data(await service.act(F, { kind: "withdraw_request" }));
    const row = async () => data(await service.listSessions(null)).map((l) => [l.id, l.settlement]);
    expect(data(service.settle(F, true)).settlement, "a branch settles its brainstorm").toEqual({ state: "settled", at: "2026-11-05T10:04:00.000Z" });
    data(await service.act(F, { kind: "make_primary" }));
    expect(await row()).toEqual([[F, { state: "settled", at: "2026-11-05T10:04:00.000Z" }]]);
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    expect(await row(), "the old primary's request wakes it").toEqual([[F, { state: "active", unsettledAt: null }]]);
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

  test("a request withdrawn while the fresh thread starts stays withdrawn", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" }));
    bridge.thread(T1).missing = true;
    await service.tick();
    bridge.startMode = "hang";
    const refreshing = service.act(S, { kind: "refresh_thread" });
    expect(await service.act(S, { kind: "refresh_thread" }), "one start at a time").toEqual({
      ok: false,
      error: { code: "invalid_action", message: "a fresh thread is already starting for this brainstorm" },
    });
    data(await service.act(S, { kind: "withdraw_request" }));
    bridge.startMode = "deliver";
    bridge.release();
    data(await refreshing);
    const fresh = bridge.started[0]!.thread;
    expect(bridge.started).toHaveLength(1);
    expect(data(await service.view(S)).attachment.threadId).toBe(fresh);
    expect(data(await service.view(S)).request?.request).toMatchObject({ n: 1, threadId: T1, state: { state: "withdrawn" } });
    expect(bridge.sent.map((m) => m.thread), "nothing went to the fresh thread").toEqual([T1]);
  });

  test("a request opened while the fresh thread starts moves to it", async () => {
    const { service, bridge } = await withIteration();
    bridge.startMode = "hang";
    const refreshing = service.act(S, { kind: "refresh_thread" });
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" }));
    bridge.startMode = "deliver";
    bridge.release();
    data(await refreshing);
    const fresh = bridge.started[0]!.thread;
    expect(bridge.sent.map((m) => [m.thread, m.message.split("\n")[0]])).toEqual([
      [T1, `[brainstorm] session ${S} · request 1 · scope: all · freetext: "again"`],
      [fresh, `[brainstorm] session ${S} · request 1 · scope: all · freetext: "again"`],
    ]);
    expect(data(await service.view(S)).request?.request).toMatchObject({ n: 1, threadId: fresh, state: { state: "sent" } });
  });

  test("a fresh thread moves every branch's open request: this branch's goes, and the other waits for a retry", async () => {
    const { service, bridge, dbPath } = await withPastTwoWheels();
    bridge.sendMode = "fail";
    data(await service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: "Try a slot machine" }));
    bridge.sendMode = "deliver";
    // What migration 12 can leave: the root's request open beside an old fork's failed one.
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO request(session_id, n, body_json, feedback_ids_json, base, thread_id, state, created_at) VALUES (?, 1, ?, '[]', 3, ?, 'sent', ?)").run(
      S,
      JSON.stringify({ scope: { kind: "all" }, freetext: null }),
      T1,
      AT,
    );
    db.close();
    bridge.thread(T1).missing = true;
    await service.tick();

    data(await service.act(F, { kind: "refresh_thread" }));
    const fresh = bridge.started[0]!.thread;
    expect(data(await service.view(F)).request?.request).toMatchObject({ n: 1, threadId: fresh, state: { state: "sent" } });
    expect(data(await service.view(S)).request?.request).toMatchObject({
      n: 1,
      threadId: fresh,
      state: { state: "send_failed", error: "the fresh thread takes one request at a time, and another branch's went first; retry once it is done" },
    });
    expect(bridge.sent.map((m) => [m.thread, m.message.split("\n")[0]])).toEqual([
      [fresh, `[brainstorm] session ${F} · request 1 · branch of ${S} iteration 2 · scope: all · feedback: #1 #2 #3 · freetext: "Try a slot machine"`],
    ]);

    // Once the branch's request closes, the waiting one goes, and the branch's next request waits for it in turn.
    expect((await phaseOf(service, S))?.actions, "no Retry while the branch's request holds the thread").toEqual(["open_thread", "withdraw"]);
    data(await service.act(F, { kind: "withdraw_request" }));
    expect((await phaseOf(service, S))?.actions).toEqual(["retry", "open_thread", "withdraw"]);
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.at(-1)).toMatchObject({ thread: fresh, message: expect.stringMatching(new RegExp(`^\\[brainstorm\\] session ${S} · request 1 · scope: all\\n`)) });
    expect(await service.act(F, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" })).toEqual({
      ok: false,
      error: { code: "request_open", message: `branch ${S} has request 1 open on this thread; let it finish or withdraw it first`, n: 1 },
    });
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

  test("a send that finishes after the agent's commit fulfilled its confirm leaves it fulfilled, and the marks spent", async () => {
    const { service, bridge } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    bridge.sendMode = "hang";
    const confirming = service.act(S, { kind: "confirm" });
    data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED }), addresses: [], note: null }));
    bridge.sendMode = "deliver";
    bridge.release();
    data(await confirming);
    const view = data(await service.view(S));
    expect([view.request?.request.n, view.request?.request.state, view.marks, view.regenerate]).toEqual([1, { state: "fulfilled", iteration: 3 }, NONE, { ok: true }]);
    expect(await holders(service, [S])).toEqual([]);
  });

  test("a send that finishes after Rob withdrew its request leaves it withdrawn", async () => {
    const { service, bridge } = await withIteration();
    bridge.sendMode = "hang";
    const regenerating = service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" });
    data(await service.act(S, { kind: "withdraw_request" }));
    bridge.sendMode = "deliver";
    bridge.release();
    data(await regenerating);
    const view = data(await service.view(S));
    expect([view.request?.request.n, view.request?.request.state, view.regenerate]).toEqual([1, { state: "withdrawn" }, { ok: true }]);
  });

  test("a send to a lost thread that fails after a fresh thread took its request over leaves it sent there", async () => {
    const { service, bridge } = await withIteration();
    bridge.sendMode = "hang";
    const regenerating = service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" });
    bridge.thread(T1).missing = true;
    data(await service.act(S, { kind: "check_thread" }));
    bridge.sendMode = "deliver";
    data(await service.act(S, { kind: "refresh_thread" }));
    const fresh = bridge.started[0]!.thread;
    bridge.sendMode = "fail";
    bridge.release();
    data(await regenerating);
    expect(data(await service.view(S)).request?.request).toMatchObject({ n: 1, threadId: fresh, state: { state: "sent" } });
    expect(await holders(service, [S])).toEqual([[S, 1]]);
  });

  test("a branch's send that finishes after a fresh thread gave the root's request the thread leaves the branch's waiting", async () => {
    const { service, bridge, dbPath } = await withPastTwoWheels();
    bridge.sendMode = "hang";
    const branching = service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: "Try a slot machine" });
    await vi.waitFor(async () => expect((await phaseOf(service, F))?.phase).toBe("sending"));
    // What migration 12 can leave: the root's request open beside the branch's.
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO request(session_id, n, body_json, feedback_ids_json, base, thread_id, state, created_at) VALUES (?, 1, ?, '[]', 3, ?, 'sent', ?)").run(
      S,
      JSON.stringify({ scope: { kind: "all" }, freetext: null }),
      T1,
      AT,
    );
    db.close();
    bridge.thread(T1).missing = true;
    data(await service.act(S, { kind: "check_thread" }));
    bridge.sendMode = "deliver";
    data(await service.act(S, { kind: "refresh_thread" }));
    const fresh = bridge.started[0]!.thread;
    bridge.release();
    data(await branching);
    expect(data(await service.view(F)).request?.request).toMatchObject({
      n: 1,
      threadId: fresh,
      state: { state: "send_failed", error: "the fresh thread takes one request at a time, and another branch's went first; retry once it is done" },
    });
    expect(data(await service.view(S)).request?.request).toMatchObject({ n: 1, threadId: fresh, state: { state: "sent" } });
    expect(await holders(service, [S, F]), "only the root's request holds the fresh thread").toEqual([[S, 1]]);
  });

  test("a branch's request waits while another branch's holds the thread: no Retry, and a retry is refused", async () => {
    const { service, bridge, dbPath } = await withPastTwoWheels();
    bridge.sendMode = "fail";
    data(await service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: "Try a slot machine" }));
    bridge.sendMode = "deliver";
    // What migration 12 can leave: the root's request open beside an old fork's failed one.
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO request(session_id, n, body_json, feedback_ids_json, base, thread_id, state, created_at) VALUES (?, 1, ?, '[]', 3, ?, 'sent', ?)").run(
      S,
      JSON.stringify({ scope: { kind: "all" }, freetext: null }),
      T1,
      AT,
    );
    db.close();
    expect(await phaseOf(service, F)).toEqual({
      phase: "send_failed",
      actions: ["open_thread", "withdraw"],
      message: "Couldn't send (t3 did not answer within 15 s). The request is saved.",
    });
    expect(await service.act(F, { kind: "retry_request" })).toEqual({
      ok: false,
      error: { code: "request_open", message: `branch ${S} has request 1 open on this thread; let it finish or withdraw it first`, n: 1 },
    });
    expect(bridge.sent).toEqual([]);

    data(await service.act(S, { kind: "withdraw_request" }));
    expect((await phaseOf(service, F))?.actions).toEqual(["retry", "open_thread", "withdraw"]);
    data(await service.act(F, { kind: "retry_request" }));
    expect(bridge.sent.map((m) => m.message.split("\n")[0])).toEqual([
      `[brainstorm] session ${F} · request 1 · branch of ${S} iteration 2 · scope: all · feedback: #1 #2 #3 · freetext: "Try a slot machine"`,
    ]);
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
      branchOf: null,
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

/** The requests among `ids` that hold the brainstorm's thread: being sent to it, or queued or worked there. */
async function holders(service: Brainstorm, ids: readonly SessionId[]): Promise<[SessionId, number][]> {
  const out: [SessionId, number][] = [];
  for (const id of ids) {
    const view = await service.view(id);
    const r = view.ok ? view.data.request : null;
    if (r !== null && ["sending", "queued", "asking", "working"].includes(r.phase.phase)) out.push([id, r.request.n]);
  }
  return out;
}

/** The shared checker, except that a check waits while held, so a test can act while a commit's check is out. */
function holdingChecker() {
  let hold: Promise<void> | null = null;
  let release = () => {};
  const held: Checker = {
    checkBlocks: async (blocks, overrides, env) => {
      if (hold !== null) await hold;
      return checker.checkBlocks(blocks, overrides, env);
    },
    checkSource: (input) => checker.checkSource(input),
    inspectKit: (kit) => checker.inspectKit(kit),
    close: async () => {},
  };
  return {
    held,
    hold: () => void (hold = new Promise<void>((resolve) => (release = resolve))),
    release: () => {
      hold = null;
      release();
    },
  };
}

const NONE: Marks = { mains: {}, grafts: [], trashed: [] };
const KEEP_NEON: Marks = { ...NONE, mains: { ["wheel" as SlotId]: "neon" as VariantKey } };
const SPIN = "spin-button" as PartName;
const WHEEL = "wheel" as SlotId;
const REEL = "wheel/reel" as BlockId;
const slotReelJson = JSON.stringify({ title: "Slot reel", props: wheelProps });
/** Neon as the agent leaves it once it has merged a graft in. */
const MERGED = { tsx: neonTsx.replace(">Spin<", ">SPIN<"), json: neonJson };
/** Calm as it was: a confirm that grafts from it keeps it (ADR 010). */
const CALM_AS_IS = { "wheel/calm": { tsx: neonTsx, json: calmJson } };

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
    expect(origin?.kind === "request" && origin.body.scope).toEqual({ kind: "confirm", mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }], grafts: [], drop: [CALM] });
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
      mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }],
      grafts: [{ from: { blockId: CALM, part: SPIN }, into: "wheel", instruction: "under the wheel" }],
      drop: [],
    });
    expect(await service.act(S, { kind: "trash", blockId: SHEET })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "a confirm is open; its marks change once it lands or you withdraw it" },
    });
    const context = data(await service.context(S, T1));
    expect(context.marks.grafts.map((g) => g.from)).toEqual([{ blockId: CALM, part: SPIN }]);

    const result = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED, ...CALM_AS_IS }), addresses: [], note: "spin button from Calm" }));
    expect(result.warnings, "Calm, the pick's source, stays beside Main with no confirm_mismatch").toEqual([]);
    const landed = data(await service.view(S));
    expect(landed.marks, "the pick is spent; Main's mark stays while Calm sits beside it, an option with no mark").toEqual(KEEP_NEON);
    expect([landed.iteration?.slots[0]?.variants, landed.overrides.applicable.map((o) => [o.blockId, o.prop]), landed.feedback.map((f) => f.id)], "Calm keeps its setting and pin").toEqual([
      ["calm", "neon"],
      [
        [CALM, "spinSeconds"],
        [NEON, "accent"],
        [NEON, "density"],
      ],
      [1, 2, 3],
    ]);
    data(await service.act(S, { kind: "confirm" }));
    const next = data(await service.view(S));
    expect([next.iteration?.slots[0]?.variants, next.request?.request.scope], "the next Confirm drops Calm like any option beside Main").toEqual([
      ["neon"],
      { kind: "confirm", mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }], grafts: [], drop: [CALM] },
    ]);

    const other = await withTwoWheels();
    data(await other.service.act(S, { kind: "approve", blockId: NEON }));
    data(await other.service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: "wheel" as SlotId, instruction: null }));
    data(await other.service.act(S, { kind: "confirm" }));
    const noSpin = neonTsx.replace('<button data-part="spin-button">Spin</button>', "");
    const bad = copy(2, { "wheel/neon": { tsx: noSpin, json: neonJson }, "wheel/calm": { tsx: neonTsx, json: calmJson } });
    const warned = data(await other.service.commit({ session: S, thread: T1, files: bad, addresses: [], note: null }));
    expect(warned.warnings.map((w) => [w.code, w.message])).toEqual([
      ["pin_lost", 'feedback #1 ("bigger button") is pinned to data-part "spin-button" in wheel/neon, which this commit no longer renders'],
      ["confirm_mismatch", 'wheel/neon doesn\'t render data-part "spin-button", the element request 1 grafts into it from wheel/calm'],
    ]);
  });

  test("a confirm the app answers lets go of the dropped variant's settings and open pins, and keeps the rest", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "confirm" }));
    const view = data(await service.view(S));
    expect(view.overrides.applicable.map((o) => [o.blockId, o.prop, o.value]), "Neon keeps Rob's settings").toEqual([
      [NEON, "accent", "#00ff88"],
      [NEON, "density", "roomy"],
    ]);
    expect(view.overrides.inapplicable, "Calm's setting went with Calm").toEqual([]);
    expect(view.feedback.map((f) => [f.id, f.pin.blockId])).toEqual([
      [1, NEON],
      [3, SHEET],
    ]);
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    expect(data(await service.view(S)).request?.request.feedbackIds, "the next request asks only about what is left").toEqual([1, 3]);
  });

  test("a confirm the agent answers lets go of what its commit drops, warns of none of it, and keeps a variant it kept against the confirm", async () => {
    const confirmed = async () => {
      const ctx = await withTwoWheels();
      data(await ctx.service.act(S, { kind: "approve", blockId: NEON }));
      // A pick from the sheet, so Calm is no graft's source and the confirm drops it.
      data(await ctx.service.act(S, { kind: "add_graft", from: { blockId: SHEET, part: null }, into: WHEEL, instruction: "its layout" }));
      data(await ctx.service.act(S, { kind: "confirm" }));
      return ctx.service;
    };
    const service = await confirmed();
    expect(data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED }), addresses: [], note: null })).warnings).toEqual([]);
    const view = data(await service.view(S));
    expect([view.overrides.applicable.map((o) => [o.blockId, o.prop]), view.overrides.inapplicable]).toEqual([
      [
        [NEON, "accent"],
        [NEON, "density"],
      ],
      [],
    ]);
    expect(view.feedback.map((f) => f.id)).toEqual([1, 3]);

    const other = await confirmed();
    const kept = data(await other.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED,"wheel/calm": { tsx: neonTsx, json: calmJson } }), addresses: [], note: null }));
    expect(kept.warnings.map((w) => w.code)).toEqual(["confirm_mismatch"]);
    const after = data(await other.view(S));
    expect(after.overrides.applicable.map((o) => [o.blockId, o.prop])).toEqual([
      [CALM, "spinSeconds"],
      [NEON, "accent"],
      [NEON, "density"],
    ]);
    expect(after.feedback.map((f) => f.id)).toEqual([1, 2, 3]);
  });

  test("a confirm's commit warns when it changes a block outside its grafts and drops, and when it loses a Main", async () => {
    const confirmed = async () => {
      const ctx = await withTwoWheels();
      data(await ctx.service.act(S, { kind: "approve", blockId: NEON }));
      data(await ctx.service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
      data(await ctx.service.act(S, { kind: "confirm" }));
      return ctx.service;
    };
    const service = await confirmed();
    const big = { tsx: sheetTsx.replace("<section", '<section className="big"'), json: sheetJson };
    const result = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED, ...CALM_AS_IS, "result/sheet": big }), addresses: [], note: null }));
    expect(result.warnings.map((w) => [w.code, w.message])).toEqual([
      ["out_of_scope", "result/sheet changed, but request 1 asked only for the grafts into Main and the dropped variants"],
    ]);

    const deleted = await confirmed();
    const gone = data(await deleted.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED }), addresses: [], note: null }));
    expect(gone.warnings.map((w) => [w.code, w.message]), "the confirm keeps the pick's source, so deleting it is news").toEqual([
      ["override_dropped", "Rob set spinSeconds = 3 on wheel/calm, and it no longer applies (block_removed); he'll see it flagged"],
      ["pin_lost", 'feedback #2 ("too grey") is pinned to wheel/calm, which this commit no longer renders'],
      ["out_of_scope", "wheel/calm changed, but request 1 asked only for the grafts into Main and the dropped variants"],
    ]);

    const other = await confirmed();
    const renamed: FileMap = Object.fromEntries(
      Object.entries(copy(2, { "wheel/neon-two": { tsx: neonTsx, json: neonJson }, ...CALM_AS_IS })).filter(([path]) => !path.startsWith("slots/wheel/neon/")),
    );
    const lost = data(await other.commit({ session: S, thread: T1, files: renamed, addresses: [], note: null }));
    expect(lost.warnings.filter((w) => w.code === "confirm_mismatch").map((w) => [w.code, w.message]), "the new id sits beside a Main that is gone").toEqual([
      ["confirm_mismatch", "request 1 keeps only Main in slot wheel, and this commit has wheel/neon-two beside it"],
      ["confirm_mismatch", "request 1 keeps wheel/neon as Main, and this commit no longer has it"],
    ]);
  });

  test("a confirm's commit warns, once each, of a variant beside Main and of a Main renamed in title only", async () => {
    const confirmed = async () => {
      const ctx = await withTwoWheels();
      data(await ctx.service.act(S, { kind: "approve", blockId: NEON }));
      data(await ctx.service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
      data(await ctx.service.act(S, { kind: "confirm" }));
      return ctx.service;
    };
    const service = await confirmed();
    const beside = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED, ...CALM_AS_IS, "wheel/reel": { tsx: neonTsx, json: slotReelJson } }), addresses: [], note: null }));
    expect(beside.warnings.map((w) => [w.code, w.message])).toEqual([
      ["confirm_mismatch", "request 1 keeps only Main in slot wheel, and this commit has wheel/reel beside it"],
    ]);

    const other = await confirmed();
    const retitled = { tsx: neonTsx, json: JSON.stringify({ title: "Neon wheel two", props: wheelProps }) };
    const renamed = data(await other.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": retitled, ...CALM_AS_IS }), addresses: [], note: null }));
    expect(renamed.warnings.map((w) => [w.code, w.message])).toEqual([
      ["confirm_mismatch", 'wheel/neon is titled "Neon wheel two"; request 1 keeps it as Main titled "Neon wheel"'],
    ]);
  });

  test("a confirm keeps a graft waiting for its slot's Main, on the app's path and the agent's", async () => {
    const waiting = async () => {
      const ctx = await withTwoWheels();
      const calm = { tsx: neonTsx, json: calmJson };
      data(await ctx.service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": calm, "wheel/reel": { tsx: neonTsx, json: slotReelJson } }), addresses: [], note: null }));
      data(await ctx.service.act(S, { kind: "trash", blockId: REEL }));
      // The graft waits, unread, once its slot's Main is taken back.
      data(await ctx.service.act(S, { kind: "approve", blockId: NEON }));
      data(await ctx.service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
      data(await ctx.service.act(S, { kind: "approve", blockId: NEON }));
      return ctx.service;
    };
    const service = await waiting();
    data(await service.act(S, { kind: "confirm" }));
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.iteration?.slots[0]?.variants, view.marks]).toEqual([4, ["calm", "neon"], NONE]);
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    expect(data(await service.view(S)).marks.grafts.map((g) => [g.from.blockId, g.into]), "the waiting graft is still there").toEqual([[CALM, "wheel"]]);

    const agent = await waiting();
    data(await agent.act(S, { kind: "add_graft", from: { blockId: NEON, part: SPIN }, into: "result" as SlotId, instruction: null }));
    data(await agent.act(S, { kind: "confirm" }));
    const sheetWithSpin = { tsx: sheetTsx.replace("{headline}", '{headline}<button data-part="spin-button">Spin</button>'), json: sheetJson };
    data(await agent.commit({ session: S, thread: T1, files: copy(3, { "wheel/calm": { tsx: neonTsx, json: calmJson }, "result/sheet": sheetWithSpin }), addresses: [], note: null }));
    expect(data(await agent.view(S)).marks, "the pick into the result sheet is spent").toEqual(NONE);
    data(await agent.act(S, { kind: "approve", blockId: NEON }));
    expect(data(await agent.view(S)).marks.grafts.map((g) => [g.from.blockId, g.into])).toEqual([[CALM, "wheel"]]);
  });

  test("a pick into a slot with no Main makes the variant that shows its Main", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "add_graft", from: { blockId: NEON, part: SPIN }, into: "wheel" as SlotId, instruction: null }));
    const marks = data(await service.view(S)).marks;
    expect(marks.mains).toEqual({ wheel: "calm" });
    expect(marks.grafts.map((g) => [g.from.blockId, g.into])).toEqual([[NEON, "wheel"]]);
    expect(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: null }, into: "wheel" as SlotId, instruction: null })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "That element is already in Main" },
    });
  });

  test("a refused pick writes nothing, and a pick whose chosen variant is trashed lands in the one that shows", async () => {
    const { service } = await withTwoWheels();
    data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": { tsx: neonTsx, json: calmJson }, "wheel/reel": { tsx: neonTsx, json: slotReelJson } }), addresses: [], note: null }));
    const marks = async () => data(await service.view(S)).marks;
    expect(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }), "Calm shows, so it would be Main").toEqual({
      ok: false,
      error: { code: "invalid_action", message: "That element is already in Main" },
    });
    expect(await marks(), "the refusal made no Main").toEqual(NONE);

    data(await service.act(S, { kind: "trash", blockId: CALM }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: REEL, part: SPIN }, into: WHEEL, instruction: null }));
    const after = await marks();
    expect([after.mains, after.trashed, after.grafts.map((g) => g.from.blockId)], "Rob chose Calm, then trashed it, so Neon shows").toEqual([{ wheel: "neon" }, [CALM], [REEL]]);
    expect(data(await service.view(S)).iteration?.slots[0]?.active).toBe("neon");
  });

  test("withdrawing a confirm with a pick gives Rob his marks back to change", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));
    expect(await service.act(S, { kind: "remove_graft", id: 1 as GraftId })).toMatchObject({ ok: false, error: { code: "invalid_action" } });
    data(await service.act(S, { kind: "withdraw_request" }));
    data(await service.act(S, { kind: "remove_graft", id: 1 as GraftId }));
    data(await service.act(S, { kind: "approve", blockId: CALM }));
    expect(data(await service.view(S)).marks).toEqual({ mains: { wheel: "calm" }, grafts: [], trashed: [] });
  });

  test("an iteration that drops a variant drops its marks, so a later variant with that key starts unmarked", async () => {
    const { service } = await withTwoWheels();
    const calm = { tsx: neonTsx, json: calmJson };
    const reel = { tsx: neonTsx, json: slotReelJson };
    data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": calm, "wheel/reel": reel }), addresses: [], note: null }));
    data(await service.act(S, { kind: "trash", blockId: REEL }));
    // A graft waits, unread, while its slot has no Main; an iteration that keeps its blocks keeps it.
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    expect(data(await service.view(S)).marks).toEqual({ mains: {}, grafts: [], trashed: [REEL] });

    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "drop the reel" }));
    data(await service.commit({ session: S, thread: T1, files: copy(3, { "wheel/calm": calm }), addresses: [], note: null }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "a new reel" }));
    data(await service.commit({ session: S, thread: T1, files: copy(4, { "wheel/calm": calm, "wheel/reel": reel }), addresses: [], note: null }));
    expect(data(await service.view(S)).marks.trashed, "the new reel isn't the old one Rob trashed").toEqual([]);
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    expect(data(await service.view(S)).marks.grafts.map((g) => [g.from.blockId, g.into]), "the waiting graft is back").toEqual([[CALM, "wheel"]]);
  });

  test("a confirm the app answers lets go of a waiting graft whose source it drops, so a later variant with that key doesn't revive it", async () => {
    const { service } = await withTwoWheels();
    const calm = { tsx: neonTsx, json: calmJson };
    const reel = { tsx: neonTsx, json: slotReelJson };
    data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": calm, "wheel/reel": reel }), addresses: [], note: null }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    // Neon off Main: the graft waits, unread, and Calm can be trashed.
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "trash", blockId: CALM }));
    data(await service.act(S, { kind: "confirm" }));
    const confirmed = data(await service.view(S));
    expect([confirmed.iteration?.n, confirmed.iteration?.slots[0]?.variants, confirmed.request?.request.state]).toEqual([4, ["neon", "reel"], { state: "fulfilled", iteration: 4 }]);

    data(await service.commit({ session: S, thread: T1, files: copy(4, { "wheel/calm": calm, "wheel/reel": reel }), addresses: [], note: "a new calm" }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    expect(data(await service.view(S)).marks, "the new Calm isn't the one Rob picked from").toEqual({ mains: { wheel: "neon" }, grafts: [], trashed: [] });
  });

  test("a confirm's commit based on an older iteration is refused as stale, and its marks are still held", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));
    expect(await service.commit({ session: S, thread: T1, files: copy(1), addresses: [], note: null })).toEqual({
      ok: false,
      error: {
        code: "stale_working_copy",
        message: "the working copy is based on iteration 1, but iteration 2 is the latest; pull again and reapply your edits",
        base: 1,
        latest: 2,
      },
    });
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.request?.request.state.state]).toEqual([2, "sent"]);
    expect(view.marks).toEqual({ mains: { wheel: "neon" }, grafts: [{ id: 1, from: { blockId: CALM, part: SPIN }, into: "wheel", instruction: null }], trashed: [] });
    expect(await service.act(S, { kind: "trash", blockId: CALM }), "the confirm is still open, so they still can't change").toEqual({
      ok: false,
      error: { code: "invalid_action", message: "a confirm is open; its marks change once it lands or you withdraw it" },
    });
  });

  test("a whole-block graft the commit leaves unapplied warns, though the commit drops what it should and keeps its source", async () => {
    const { service } = await withTwoWheels();
    // The reel, trashed, gives the commit something to drop: one that kept everything would change nothing, and land nothing.
    data(await service.commit({ session: S, thread: T1, files: copy(2, { ...CALM_AS_IS, "wheel/reel": { tsx: neonTsx, json: slotReelJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "trash", blockId: REEL }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: null }, into: WHEEL, instruction: "its calm colours" }));
    data(await service.act(S, { kind: "confirm" }));
    expect(data(await service.view(S)).request?.request.scope).toEqual({
      kind: "confirm",
      mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }],
      grafts: [{ from: { blockId: CALM, part: null }, into: "wheel", instruction: "its calm colours" }],
      drop: [REEL],
    });
    const result = data(await service.commit({ session: S, thread: T1, files: copy(3, CALM_AS_IS), addresses: [], note: null }));
    expect(result.warnings.map((w) => [w.code, w.file, w.message])).toEqual([
      ["confirm_mismatch", "slots/wheel/neon/block.tsx", "request 1 grafts all of wheel/calm into wheel/neon, and this commit leaves wheel/neon as it was"],
    ]);
    expect(data(await service.view(S)).request?.request.state, "a warning, not a refusal").toEqual({ state: "fulfilled", iteration: 4 });
  });

  test("a graft whose part the commit's Main doesn't render isn't spent: it waits under Main for the next confirm", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: "result" as SlotId, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));
    const big = { tsx: sheetTsx.replace("<section", '<section className="big"'), json: sheetJson };
    const result = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": { tsx: neonTsx, json: calmJson }, "result/sheet": big }), addresses: [], note: null }));
    expect(result.warnings.map((w) => [w.code, w.message])).toEqual([
      ["confirm_mismatch", 'result/sheet doesn\'t render data-part "spin-button", the element request 1 grafts into it from wheel/calm'],
    ]);
    expect(data(await service.view(S)).marks, "the sheet is the result slot's only variant, so it is Main without a mark").toEqual({
      mains: {},
      grafts: [{ id: 1, from: { blockId: CALM, part: SPIN }, into: "result", instruction: null }],
      trashed: [],
    });
  });

  test("of two grafts into one Main, only the one the commit didn't apply stays", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: null }, into: "result" as SlotId, instruction: "its calm colours" }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: "result" as SlotId, instruction: "under the headline" }));
    data(await service.act(S, { kind: "confirm" }));
    const calmer = { tsx: sheetTsx.replace("<section", '<section className="calm"'), json: sheetJson };
    const result = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": { tsx: neonTsx, json: calmJson }, "result/sheet": calmer }), addresses: [], note: null }));
    expect(result.warnings.map((w) => w.message)).toEqual(['result/sheet doesn\'t render data-part "spin-button", the element request 1 grafts into it from wheel/calm']);
    expect(data(await service.view(S)).marks.grafts).toEqual([{ id: 2, from: { blockId: CALM, part: SPIN }, into: "result", instruction: "under the headline" }]);
  });

  test("a vary option's graft the commit leaves out stays live, and goes with the next confirm", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: SPIN }, count: 2, direction: null }));
    const spinTsx = (label: string) => `export default function Spin() {\n  return <button data-part="spin-button">${label}</button>;\n}\n`;
    const option = (label: string) => ({ tsx: spinTsx(label), json: JSON.stringify({ title: `Spin button ${label.toUpperCase()}`, props: { appearance: {} } }) });
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/spin-button-a": option("a"), "wheel/spin-button-b": option("b") }), addresses: [], note: null }));
    const optionA = "wheel/spin-button-a" as BlockId;
    const optionB = "wheel/spin-button-b" as BlockId;
    data(await service.act(S, { kind: "trash", blockId: optionA }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: optionB, part: SPIN }, into: "result" as SlotId, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));

    // The agent drops Spin button A, as asked, and leaves the sheet as it was.
    const result = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/spin-button-b": option("b") }), addresses: [], note: null }));
    expect(result.warnings.map((w) => w.message)).toEqual([
      'request 2 grafts data-part "spin-button" from wheel/spin-button-b into result/sheet, and this commit leaves result/sheet as it was',
    ]);
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.request?.request.state]).toEqual([3, { state: "fulfilled", iteration: 3 }]);
    expect(view.marks, "Main's mark and the trash are spent; the graft is not").toEqual({
      mains: {},
      grafts: [{ id: 1, from: { blockId: optionB, part: "spin-button" }, into: "result", instruction: null }],
      trashed: [],
    });

    data(await service.act(S, { kind: "confirm" }));
    expect(data(await service.view(S)).request?.request.scope).toEqual({
      kind: "confirm",
      mains: [{ slot: "result", variant: "sheet" }],
      grafts: [{ from: { blockId: optionB, part: "spin-button" }, into: "result", instruction: null }],
      drop: [],
    });
  });

  test("a graft the commit didn't apply keeps its source and its slot's Main mark, and the next confirm carries it again", async () => {
    const { service } = await withTwoWheels();
    // The reel, trashed, gives the commit something to drop: one that kept everything would change nothing, and land nothing.
    data(await service.commit({ session: S, thread: T1, files: copy(2, { ...CALM_AS_IS, "wheel/reel": { tsx: neonTsx, json: slotReelJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "trash", blockId: REEL }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));
    const result = data(await service.commit({ session: S, thread: T1, files: copy(3, CALM_AS_IS), addresses: [], note: null }));
    expect(result.warnings.map((w) => w.message)).toEqual([
      'request 1 grafts data-part "spin-button" from wheel/calm into wheel/neon, and this commit leaves wheel/neon as it was',
    ]);
    expect(data(await service.view(S)).marks).toEqual({
      mains: { wheel: "neon" },
      grafts: [{ id: 1, from: { blockId: CALM, part: SPIN }, into: "wheel", instruction: null }],
      trashed: [],
    });
    data(await service.act(S, { kind: "confirm" }));
    expect(data(await service.view(S)).request?.request.scope).toEqual({
      kind: "confirm",
      mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }],
      grafts: [{ from: { blockId: CALM, part: SPIN }, into: "wheel", instruction: null }],
      drop: [],
    });
  });

  test("a confirm with nothing to graft lands on a lost thread with no agent turn, and still waits for an open request", async () => {
    const { service, bridge } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));
    bridge.thread(T1).missing = true;
    data(await service.act(S, { kind: "check_thread" }));
    expect(await service.act(S, { kind: "confirm" }), "its commit could land on top").toEqual({
      ok: false,
      error: { code: "request_open", message: "request 1 is still open; withdraw it first", n: 1 },
    });
    data(await service.act(S, { kind: "withdraw_request" }));
    const sent = bridge.sent.length;
    data(await service.act(S, { kind: "confirm" }));
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.iteration?.slots.map((s) => s.variants), view.request?.request.n, view.request?.request.state, view.attachment.lostAt]).toEqual([
      3,
      [["neon"], ["sheet"]],
      2,
      { state: "fulfilled", iteration: 3 },
      AT,
    ]);
    expect(view.regenerate, "the thread is still lost").toEqual({ ok: false, reason: "thread_lost" });
    expect(bridge.sent.length, "no agent turn").toBe(sent);

    const grafting = await withTwoWheels();
    data(await grafting.service.act(S, { kind: "approve", blockId: NEON }));
    data(await grafting.service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    grafting.bridge.thread(T1).missing = true;
    data(await grafting.service.act(S, { kind: "check_thread" }));
    expect(await grafting.service.act(S, { kind: "confirm" }), "a graft needs the agent").toEqual({
      ok: false,
      error: { code: "thread_lost", message: `thread ${T1} is gone; start a fresh thread for the brainstorm first`, thread: T1 },
    });
    expect(data(await grafting.service.view(S)).iteration?.n).toBe(2);
  });

  test("a confirm's commit is refused as stale when Rob withdraws the confirm and opens another request while it is checked", async () => {
    const check = holdingChecker();
    const { service } = await setup(undefined, undefined, check.held);
    data(await service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/calm": { tsx: neonTsx, json: calmJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "set_override", blockId: CALM, prop: "spinSeconds" as PropName, value: 3 }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));

    check.hold();
    const committing = service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED }), addresses: [], note: null });
    data(await service.act(S, { kind: "withdraw_request" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));
    check.release();
    expect(await committing).toEqual({
      ok: false,
      error: {
        code: "stale_working_copy",
        message: `request 1 was open when this commit was checked, and request 2 is now; run brainstorm context ${S} and commit again`,
        base: 2,
        latest: 2,
      },
    });
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.request?.request.n, view.request?.request.state]).toEqual([2, 2, { state: "sent" }]);
    expect(view.overrides.applicable.map((o) => [o.blockId, o.prop]), "nothing was let go of").toEqual([[CALM, "spinSeconds"]]);
  });

  test("a confirm Rob withdrew before its commit lands: the commit is the agent's own, and the marks stay but for blocks it removed", async () => {
    const { service } = await withTwoWheels();
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));
    data(await service.act(S, { kind: "withdraw_request" }));
    const result = data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED }), addresses: [], note: "spin button from Calm" }));
    expect(result.warnings.map((w) => [w.code, w.message]), "nothing is let go of, so the agent hears of what Calm loses").toEqual([
      ["override_dropped", "Rob set spinSeconds = 3 on wheel/calm, and it no longer applies (block_removed); he'll see it flagged"],
      ["pin_lost", 'feedback #2 ("too grey") is pinned to wheel/calm, which this commit no longer renders'],
    ]);
    const view = data(await service.view(S));
    expect([view.iteration?.n, view.request?.request.n, view.request?.request.state, view.history.iterations.at(-1)?.origin]).toEqual([
      3,
      1,
      { state: "withdrawn" },
      { kind: "agent", note: "spin button from Calm" },
    ]);
    expect(view.marks, "Main stays; the graft from Calm went with Calm").toEqual({ mains: { wheel: "neon" }, grafts: [], trashed: [] });
    expect([view.overrides.inapplicable.map((o) => o.override.blockId), view.feedback.map((f) => f.id)]).toEqual([[CALM], [1, 2, 3]]);
  });

  test("add slot asks the agent for a new slot, and warns when the commit adds none", async () => {
    const { service } = await withIteration();
    expect(await service.act(S, { kind: "add_slot", prompt: "  " })).toEqual({ ok: false, error: { code: "invalid_action", message: "say what the new slot is for" } });
    expect(data(await service.view(S)).request, "a blank prompt opens no request").toBe(null);
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

    const third = await withIteration();
    data(await third.service.act(S, { kind: "add_slot", prompt: "The empty state" }));
    const extra = { ...files, "slots/wheel/calm/block.tsx": neonTsx, "slots/wheel/calm/block.json": calmJson };
    expect(
      data(await third.service.commit({ session: S, thread: T1, files: extra, addresses: [], note: null })).warnings.map((w) => [w.code, w.message]),
      "a new variant in a slot that was there isn't the new slot",
    ).toEqual([["out_of_scope", "wheel/calm changed, but request 1 asked only for a new slot"]]);
  });
});

describe("branches", () => {
  test("a confirm on a past iteration makes a branch on the same thread that numbers on from there", async () => {
    const { service, bridge } = await withPastTwoWheels();
    const result = await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null });
    expect(result).toEqual({ ok: true, data: { branch: F } });

    const view = data(await service.view(F));
    expect(view.session).toMatchObject({ id: F, title: "Branch 1", brief: "Pick who does chores" });
    expect(view.tree).toEqual({ root: { id: S, title: "Chore wheel" }, primary: S });
    expect(view.branchOf).toEqual({ parent: { id: S, title: "Chore wheel" }, from: 2 });
    expect(view.attachment.threadId, "every branch shares the brainstorm's thread").toBe(T1);
    expect(view.iteration?.n).toBe(3);
    expect(view.iteration?.slots.map((s) => [s.id, s.variants, s.active])).toEqual([
      ["wheel", ["neon"], "neon"],
      ["result", ["sheet"], "sheet"],
    ]);
    expect(view.history.iterations.map((e) => [e.session, e.n, e.origin.kind])).toEqual([
      [S, 1, "brief"],
      [S, 2, "agent"],
      [F, 3, "request"],
    ]);
    const confirm = { kind: "confirm", mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }], grafts: [], drop: [CALM] };
    expect(view.history.iterations.at(-1)?.origin, "the app answered the branch's confirm, as it answers one on the latest").toEqual({
      kind: "request",
      n: 1,
      body: { scope: confirm, freetext: null },
      // A branch's first iteration has nothing before it in the branch, so every block counts as changed.
      changed: ["Result sheet", "Neon wheel"],
      kept: ["Neon wheel"],
    });
    const neon = view.iteration?.blocks.find((b) => b.id === NEON);
    expect(neon?.props.appearance.find((p) => p.name === "accent")?.default, "a setting Rob changed is the branch's default").toBe("#00ff88");
    expect(view.overrides.applicable).toEqual([]);
    expect(view.feedback.map((f) => [f.pin.blockId, f.text])).toEqual([
      [NEON, "bigger button"],
      [SHEET, "say who's next"],
    ]);
    expect(view.request?.request, "keeping a Main needs no agent").toMatchObject({ n: 1, base: 2, feedbackIds: [], state: { state: "fulfilled", iteration: 3 } });
    expect(view.request?.message).toBe("Iteration 3 · Kept Neon wheel · 1 option dropped");
    expect(bridge.sent).toEqual([]);
    expect(bridge.started).toEqual([]);

    expect(data(await service.view(S)).history.branches).toEqual([{ id: F, title: "Branch 1", parent: S, from: 2 }]);
    expect(data(await service.listSessions(null)).map((l) => [l.id, l.title]), "home shows one row per brainstorm").toEqual([[S, "Chore wheel"]]);
  });

  test("an instruction goes to the agent on the shared thread, and the brainstorm has one open request at a time", async () => {
    const { service, bridge } = await withPastTwoWheels();
    data(await service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: "Try it as a slot machine" }));
    expect(bridge.sent.at(-1)?.thread).toBe(T1);
    expect(bridge.sent.at(-1)?.message.split("\n")[0]).toBe(
      `[brainstorm] session ${F} · request 1 · branch of ${S} iteration 2 · scope: all · feedback: #1 #2 #3 · freetext: "Try it as a slot machine"`,
    );
    expect(data(await service.view(F)).session.title).toBe("Try it as a slot machine");
    expect(data(await service.view(S)).regenerate).toEqual({ ok: false, reason: "branch_busy" });
    expect(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" })).toMatchObject({ ok: false, error: { code: "request_open" } });
    expect(await service.branch(S, { from: 1 as IterationN, marks: NONE, instruction: "and another" })).toMatchObject({ ok: false, error: { code: "request_open" } });
  });

  test("confirming a past iteration as a branch with a pick copies the marks, and request 1 is the confirm", async () => {
    const { service, bridge } = await withPastTwoWheels();
    const graft = { id: 1 as GraftId, from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: "under the wheel" };
    data(await service.branch(S, { from: 2 as IterationN, marks: { ...KEEP_NEON, grafts: [graft] }, instruction: null }));
    const view = data(await service.view(F));
    expect(view.marks, "the branch shows what it was confirmed with").toEqual({ mains: { wheel: "neon" }, grafts: [graft], trashed: [] });
    expect(view.iteration?.slots.map((s) => [s.id, s.variants]), "the agent does the narrowing").toEqual([
      ["wheel", ["calm", "neon"]],
      ["result", ["sheet"]],
    ]);
    expect(view.request?.request).toMatchObject({
      n: 1,
      feedbackIds: [],
      scope: {
        kind: "confirm",
        mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }],
        grafts: [{ from: { blockId: CALM, part: SPIN }, into: "wheel", instruction: "under the wheel" }],
        drop: [],
      },
    });
    expect(bridge.sent.map((m) => [m.thread, m.message.split("\n")[0]])).toEqual([
      [T1, `[brainstorm] session ${F} · request 1 · branch of ${S} iteration 2 · scope: confirm main wheel/neon, result/sheet; graft wheel/calm [spin-button] into wheel; drop none`],
    ]);
    expect(await service.act(F, { kind: "trash", blockId: SHEET }), "its marks hold while the confirm is open").toMatchObject({ ok: false, error: { code: "invalid_action" } });
  });

  test("a branch whose check outlasts a request opened meanwhile is refused, and the brainstorm keeps one open request", async () => {
    let hold: Promise<void> | null = null;
    let release = () => {};
    const held: Checker = {
      checkBlocks: async (blocks, overrides, env) => {
        if (hold !== null) await hold;
        return checker.checkBlocks(blocks, overrides, env);
      },
      checkSource: (input) => checker.checkSource(input),
      inspectKit: (kit) => checker.inspectKit(kit),
      close: async () => {},
    };
    const home = mkdtempSync(join(tmpdir(), "bs-service-"));
    const bridge = new FakeBridge();
    bridge.add(T1, "proj-a", "Design thread");
    const ids = [S, F] as SessionId[];
    const service = await Brainstorm.open({ dbPath: join(home, "brainstorm.db"), exportsDir: join(home, "exports"), bridge, checker: held, now: () => AT, newSessionId: () => ids.shift()! });
    data(await service.newSession({ title: "Chore wheel", brief: "", thread: T1, projectPath: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: null }));

    hold = new Promise<void>((resolve) => (release = resolve));
    const branching = service.branch(S, { from: 1 as IterationN, marks: NONE, instruction: "Try a slot machine" });
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));
    release();
    expect(await branching).toEqual({
      ok: false,
      error: { code: "request_open", message: "request 1 is still open on this brainstorm's thread; let it finish or withdraw it first", n: 1 },
    });
    const view = data(await service.view(S));
    expect([view.history.branches, view.request?.request.state.state]).toEqual([[], "sent"]);
    expect(bridge.sent.map((m) => m.message.split("\n")[0])).toEqual([`[brainstorm] session ${S} · request 1 · scope: all · freetext: "warmer"`]);
    service.close();
  });

  test("a vary option from before the branch point still grafts on the branch", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: SPIN }, count: 1, direction: null }));
    const spin = { tsx: `export default function Spin() {\n  return <button data-part="spin-button">a</button>;\n}\n`, json: JSON.stringify({ title: "Spin button A", props: { appearance: {} } }) };
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/spin-button-a": spin }), addresses: [], note: null }));
    data(await service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: "Try a slot machine" }));
    data(await service.act(F, { kind: "withdraw_request" }));
    const option = "wheel/spin-button-a" as BlockId;
    expect(data(await service.view(F)).iteration?.blocks.find((b) => b.id === option)?.variedFrom).toEqual({ blockId: NEON, part: "spin-button" });

    data(await service.act(F, { kind: "approve", blockId: NEON }));
    data(await service.act(F, { kind: "approve", blockId: option }));
    const marks = data(await service.view(F)).marks;
    expect([marks.mains, marks.grafts.map((g) => [g.from, g.into])]).toEqual([{ wheel: "neon" }, [[{ blockId: option, part: "spin-button" }, "wheel"]]]);
  });

  test("refuses an iteration or a mark that isn't there, and a branch with nothing to try, and writes nothing", async () => {
    const { service, bridge } = await withPastTwoWheels();
    expect(await service.branch(S, { from: 9 as IterationN, marks: NONE, instruction: "x" })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "iteration", message: `${S} has no iteration 9` },
    });
    expect(await service.branch(S, { from: 1 as IterationN, marks: { ...NONE, mains: { ["wheel" as SlotId]: "calm" as VariantKey } }, instruction: null })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "block", message: "wheel/calm is not in iteration 1" },
    });
    expect(await service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: null })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "say what the branch should try, or mark what it keeps" },
    });
    const graft = (from: BlockId, into: string) => ({ ...KEEP_NEON, grafts: [{ id: 1 as GraftId, from: { blockId: from, part: SPIN }, into: into as SlotId, instruction: null }] });
    expect(await service.branch(S, { from: 2 as IterationN, marks: graft(CALM, "footer"), instruction: null }), "a graft into a slot the iteration lacks").toEqual({
      ok: false,
      error: { code: "not_found", entity: "block", message: "slot footer is not in iteration 2" },
    });
    expect(await service.branch(S, { from: 2 as IterationN, marks: graft(REEL, "wheel"), instruction: null }), "a graft from a block it lacks").toEqual({
      ok: false,
      error: { code: "not_found", entity: "block", message: "wheel/reel is not in iteration 2" },
    });
    expect(
      await service.branch(S, { from: 2 as IterationN, marks: { ...NONE, mains: { ["result" as SlotId]: "neon" as VariantKey } }, instruction: null }),
      "a Main naming a variant from another slot",
    ).toEqual({
      ok: false,
      error: { code: "not_found", entity: "block", message: "result/neon is not in iteration 2" },
    });
    expect(bridge.sent.length).toBe(0);
    expect(data(await service.view(S)).history.branches).toEqual([]);
  });

  test("a branch that asks the agent something waits for a fresh thread; one the app answers is made on the lost thread and reads lost", async () => {
    const { service, bridge } = await withPastTwoWheels();
    bridge.thread(T1).missing = true;
    data(await service.act(S, { kind: "check_thread" }));
    expect(data(await service.view(S)).attachment.lostAt).toBe(AT);
    const lost = { ok: false, error: { code: "thread_lost", message: `thread ${T1} is gone; start a fresh thread first`, thread: T1 } };
    expect(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: "warmer" }), "an instruction").toEqual(lost);
    const pick = { ...KEEP_NEON, grafts: [{ id: 1 as GraftId, from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }] };
    expect(await service.branch(S, { from: 2 as IterationN, marks: pick, instruction: null }), "a graft").toEqual(lost);
    expect(data(await service.view(S)).history.branches).toEqual([]);

    expect(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null })).toEqual({ ok: true, data: { branch: F } });
    const branch = data(await service.view(F));
    expect([branch.attachment.threadId, branch.attachment.lostAt, branch.iteration?.n, branch.iteration?.slots.map((s) => s.variants), branch.request?.request.state]).toEqual([
      T1,
      AT,
      3,
      [["neon"], ["sheet"]],
      { state: "fulfilled", iteration: 3 },
    ]);
    expect(branch.regenerate, "the branch reads lost, as its tree does").toEqual({ ok: false, reason: "thread_lost" });
    expect(bridge.sent).toEqual([]);
  });

  test("a branch the app would answer still waits for a request open anywhere in the brainstorm, lost thread or not", async () => {
    const { service, bridge } = await withPastTwoWheels();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));
    const open = { ok: false, error: { code: "request_open", message: "request 1 is still open on this brainstorm's thread; let it finish or withdraw it first", n: 1 } };
    expect(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null })).toEqual(open);
    bridge.thread(T1).missing = true;
    data(await service.act(S, { kind: "check_thread" }));
    expect(data(await service.view(S)).attachment.lostAt).toBe(AT);
    expect(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null }), "its commit could still land").toEqual(open);
    expect(data(await service.view(S)).history.branches).toEqual([]);
  });

  test("a branch's first iteration is on the thread the tree shares, not the one its source was made on", async () => {
    const { service } = await withPastTwoWheels();
    data(await service.attach({ ref: S, thread: T2 }));
    data(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null }));
    expect(data(await service.iteration(S, 2 as IterationN)).threadId).toBe(T1);
    expect(data(await service.view(F)).iteration?.threadId).toBe(T2);
  });

  test("a variant that doesn't render with Rob's settings baked in refuses the branch", async () => {
    const { service } = await withIteration();
    const fussy = neonTsx.replace("return (", 'if (accent === "#000000") throw new Error("no black");\n  return (');
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": { tsx: fussy, json: neonJson } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: "accent" as PropName, value: "#000000" }));
    const result = await service.branch(S, { from: 2 as IterationN, marks: NONE, instruction: "darker" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^Neon wheel doesn't render with your settings as its defaults \(.*no black.*\)\. Reset the setting that breaks it, or keep another variant\.$/);
    expect(data(await service.view(S)).history.branches).toEqual([]);
  });

  test("every way a request opens or reopens leaves at most one request in the brainstorm holding its thread", async () => {
    const { service, bridge } = await withPastTwoWheels();
    data(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null }));
    const tree = [S, F, G];
    const held = () => holders(service, tree);
    const tries = async (id: SessionId): Promise<(() => Promise<Result<unknown>>)[]> => {
      const from = data(await service.view(id)).iteration!.n;
      return [
        () => service.act(id, { kind: "regenerate", scope: { kind: "all" }, freetext: "again" }),
        () => service.act(id, { kind: "vary", target: { blockId: NEON, part: SPIN }, count: 1, direction: null }),
        () => service.act(id, { kind: "add_slot", prompt: "The empty state" }),
        () => service.act(id, { kind: "confirm" }),
        () => service.branch(id, { from, marks: NONE, instruction: "Try a slot machine" }),
        () => service.act(id, { kind: "retry_request" }),
        () => service.act(id, { kind: "refresh_thread" }),
      ];
    };
    /** While `holder` holds the thread, every way from every branch is refused, and it still holds it alone. */
    const othersWait = async (holder: [SessionId, number]) => {
      for (const id of [S, F]) {
        for (const attempt of await tries(id)) expect((await attempt()).ok).toBe(false);
      }
      expect(await held()).toEqual([holder]);
    };

    // Regenerate, then Resend once the thread is taken over.
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));
    await othersWait([S, 1]);
    data(await service.attach({ ref: S, thread: T2 }));
    expect(await held(), "a request on the previous thread holds nothing").toEqual([]);
    expect((await service.act(F, { kind: "regenerate", scope: { kind: "all" }, freetext: null })).ok, "but it is still open").toBe(false);
    data(await service.act(S, { kind: "retry_request" }));
    await othersWait([S, 1]);
    data(await service.act(S, { kind: "withdraw_request" }));

    // Vary and add slot, on the branch.
    data(await service.act(F, { kind: "vary", target: { blockId: NEON, part: SPIN }, count: 1, direction: null }));
    await othersWait([F, 2]);
    data(await service.act(F, { kind: "withdraw_request" }));
    data(await service.act(F, { kind: "add_slot", prompt: "The empty state" }));
    await othersWait([F, 3]);
    data(await service.act(F, { kind: "withdraw_request" }));

    // A confirm with a graft, then a fresh thread once its thread is lost.
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "add_graft", from: { blockId: CALM, part: SPIN }, into: WHEEL, instruction: null }));
    data(await service.act(S, { kind: "confirm" }));
    await othersWait([S, 2]);
    bridge.thread(T2).missing = true;
    data(await service.act(F, { kind: "check_thread" }));
    expect(await held(), "a request on a lost thread holds nothing").toEqual([]);
    data(await service.act(F, { kind: "refresh_thread" }));
    await othersWait([S, 2]);
    data(await service.act(S, { kind: "withdraw_request" }));

    // Retry of a send that failed.
    bridge.sendMode = "fail";
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));
    expect(await held()).toEqual([]);
    bridge.sendMode = "deliver";
    expect((await service.act(F, { kind: "retry_request" })).ok).toBe(false);
    data(await service.act(S, { kind: "retry_request" }));
    await othersWait([S, 3]);
    data(await service.act(S, { kind: "withdraw_request" }));

    // A branch with an instruction.
    data(await service.branch(S, { from: 3 as IterationN, marks: NONE, instruction: "Try a slot machine" }));
    await othersWait([G, 1]);
  });

  test("make primary puts a branch on the home row, and the old main line becomes an offshoot", async () => {
    const { service } = await withPastTwoWheels();
    data(await service.branch(S, { from: 2 as IterationN, marks: KEEP_NEON, instruction: null }));
    data(await service.act(F, { kind: "make_primary" }));
    expect(data(await service.view(S)).tree.primary).toBe(F);
    expect(data(await service.listSessions(null)).map((l) => [l.id, l.title, l.latest])).toEqual([[F, "Chore wheel", 3]]);
    const history = data(await service.view(F)).history;
    expect(history.iterations.map((e) => [e.session, e.n]), "the primary's trail runs from the root to its own iterations").toEqual([
      [S, 1],
      [S, 2],
      [F, 3],
    ]);
    expect(history.branches, "the old main line hangs off iteration 2, where the primary left it").toEqual([{ id: S, title: "Chore wheel", parent: S, from: 2 }]);
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
    data(await service.branch(S, { from: 1 as IterationN, marks: NONE, instruction: "x" }));
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

  test("a vary option's graft keeps its source: a commit that leaves Main as it was warns and the next confirm carries the graft again, and once it lands the source is an option the next confirm drops", async () => {
    const grafted = async () => {
      const { service } = await withIteration();
      data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: SPIN }, count: 2, direction: null }));
      const added = Object.fromEntries(["a", "b"].map((l) => [`wheel/spin-button-${l}`, { tsx: spinTsx(l), json: spinJson(`Spin button ${l.toUpperCase()}`) }]));
      data(await service.commit({ session: S, thread: T1, files: copy(1, added), addresses: [], note: null }));
      data(await service.act(S, { kind: "approve", blockId: NEON }));
      data(await service.act(S, { kind: "approve", blockId: "wheel/spin-button-b" as BlockId }));
      data(await service.act(S, { kind: "confirm" }));
      return service;
    };
    const optionB = "wheel/spin-button-b" as BlockId;
    const keptB = { [optionB]: { tsx: spinTsx("b"), json: spinJson("Spin button B") } };
    // Neon already renders a spin-button, so the element alone can't show the graft went in.
    const untouched = await grafted();
    expect(data(await untouched.view(S)).request?.request.scope, "Spin button B is the graft's source, so only A goes").toEqual({
      kind: "confirm",
      mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }],
      grafts: [{ from: { blockId: optionB, part: "spin-button" }, into: "wheel", instruction: null }],
      drop: ["wheel/spin-button-a"],
    });
    expect(data(await untouched.commit({ session: S, thread: T1, files: copy(2, keptB), addresses: [], note: null })).warnings.map((w) => [w.code, w.file, w.message])).toEqual([
      [
        "confirm_mismatch",
        "slots/wheel/neon/block.tsx",
        'request 2 grafts data-part "spin-button" from wheel/spin-button-b into wheel/neon, and this commit leaves wheel/neon as it was',
      ],
    ]);
    expect(data(await untouched.view(S)).marks, "the graft is live, its source still there").toEqual({
      mains: { wheel: "neon" },
      grafts: [{ id: 1, from: { blockId: optionB, part: "spin-button" }, into: "wheel", instruction: null }],
      trashed: [],
    });
    data(await untouched.act(S, { kind: "confirm" }));
    expect(data(await untouched.view(S)).request?.request.scope, "the next Confirm carries it again").toEqual({
      kind: "confirm",
      mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }],
      grafts: [{ from: { blockId: optionB, part: "spin-button" }, into: "wheel", instruction: null }],
      drop: [],
    });

    const merged = await grafted();
    expect(data(await merged.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": MERGED, ...keptB }), addresses: [], note: null })).warnings).toEqual([]);
    const landed = data(await merged.view(S));
    expect([landed.iteration?.blocks.map((b) => b.id), landed.marks], "Spin button B is an option beside Main, with no mark").toEqual([
      [SHEET, NEON, optionB],
      { mains: { wheel: "neon" }, grafts: [], trashed: [] },
    ]);
    const wheel = landed.iteration!.slots.find((s) => s.id === WHEEL)!;
    expect(approval(wheel, landed.iteration!.blocks.find((b) => b.id === optionB)!, landed.marks), "its 👍 would graft its spin button again").toEqual({
      kind: "graft",
      from: { blockId: optionB, part: "spin-button" },
    });
    data(await merged.act(S, { kind: "confirm" }));
    const next = data(await merged.view(S));
    expect([next.iteration?.blocks.map((b) => b.id), next.request?.request.scope], "the next Confirm drops it with no agent turn").toEqual([
      [SHEET, NEON],
      { kind: "confirm", mains: [{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }], grafts: [], drop: [optionB] },
    ]);
  });

  test("a vary option a confirm dropped is forgotten, so a later variant with its key becomes Main on a 👍", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: "spin-button" as PartName }, count: 1, direction: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/spin-button-a": { tsx: spinTsx("a"), json: spinJson("Spin button A") } }), addresses: [], note: null }));
    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "confirm" }));
    const reused = "wheel/spin-button-a" as BlockId;
    data(await service.commit({ session: S, thread: T1, files: copy(3, { [reused]: { tsx: spinTsx("unrelated"), json: spinJson("Unrelated") } }), addresses: [], note: null }));
    expect(data(await service.view(S)).iteration?.blocks.find((b) => b.id === reused)?.variedFrom).toBe(null);

    data(await service.act(S, { kind: "approve", blockId: NEON }));
    data(await service.act(S, { kind: "approve", blockId: reused }));
    expect(data(await service.view(S)).marks).toEqual({ mains: { wheel: "spin-button-a" }, grafts: [], trashed: [] });
  });

  test("a past iteration keeps a vary option's provenance after a later confirm drops it, so a 👍 on it there grafts", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "vary", target: { blockId: NEON, part: SPIN }, count: 2, direction: null }));
    const added = Object.fromEntries(["a", "b"].map((l) => [`wheel/spin-button-${l}`, { tsx: spinTsx(l), json: spinJson(`Spin button ${l.toUpperCase()}`) }]));
    data(await service.commit({ session: S, thread: T1, files: copy(1, added), addresses: [], note: null }));
    const optionB = "wheel/spin-button-b" as BlockId;
    data(await service.act(S, { kind: "trash", blockId: optionB }));
    data(await service.act(S, { kind: "confirm" }));
    expect(data(await service.view(S)).iteration?.blocks.map((b) => b.id), "the confirm dropped Spin button B").toEqual([SHEET, NEON, "wheel/spin-button-a"]);

    const past = data(service.iteration(S, 2 as IterationN));
    const b = past.blocks.find((x) => x.id === optionB)!;
    expect(b.variedFrom).toEqual({ blockId: NEON, part: "spin-button" });
    const wheel = past.slots.find((s) => s.id === WHEEL)!;
    expect(approval(wheel, b, KEEP_NEON), "with Neon as Main, a 👍 on B brings its spin button in").toEqual({ kind: "graft", from: { blockId: optionB, part: "spin-button" } });
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

describe("a confirm with a design system", () => {
  const listTsx = `import { Card } from "kit";
import ChoreList from "proposed/ChoreList";
export default function Chores() {
  return <Card><ChoreList items={["Dishes"]} /></Card>;
}
`;
  const badgeTsx = `import { Card } from "kit";
import Badge from "proposed/Badge";
export default function Chores() {
  return <Card><Badge label="New" /></Card>;
}
`;
  const proposed = {
    ChoreList: {
      tsx: `import ChoreRow from "proposed/ChoreRow";
export default function ChoreList({ items }) {
  return <ul>{items.map((item) => <ChoreRow key={item} item={item} />)}</ul>;
}
`,
      json: { title: "Chore list", description: "The week's chores", tier: "primitive", example: { items: ["Dishes"] } },
    },
    ChoreRow: {
      tsx: `import { Text } from "kit";
export default function ChoreRow({ item }) {
  return <li><Text size="sm">{item}</Text></li>;
}
`,
      json: { title: "Chore row", description: "One chore", tier: "primitive", example: { item: "Dishes" } },
    },
    Badge: {
      tsx: `import { Text } from "kit";
export default function Badge({ label }) {
  return <span><Text size="sm">{label}</Text></span>;
}
`,
      json: { title: "Badge", description: "A short label", tier: "primitive", example: { label: "New" } },
    },
  };
  const files = (base: number | null, blocks: Record<string, string>, names: readonly (keyof typeof proposed)[]): FileMap => {
    const out: Record<string, string> = {
      "brainstorm.json": JSON.stringify({ format: 1, session: S, base, slots: [{ id: "home", title: "Home" }] }),
    };
    for (const [variant, tsx] of Object.entries(blocks)) {
      out[`slots/home/${variant}/block.tsx`] = tsx;
      out[`slots/home/${variant}/block.json`] = JSON.stringify({ title: `Chores ${variant}`, props: { appearance: {} } });
    }
    for (const name of names) {
      out[`proposed/${name}/component.tsx`] = proposed[name].tsx;
      out[`proposed/${name}/component.json`] = JSON.stringify(proposed[name].json);
    }
    return out;
  };

  test("keeps only the proposed components a kept variant imports, directly or through another, so the agent's next commit has none unused", async () => {
    // A copy inside the repo, so the library resolves react and tailwindcss from the repo's node_modules.
    const lib = mkdtempSync(join(import.meta.dirname, ".kit-"));
    try {
      cpSync(join(import.meta.dirname, "kit-lib"), lib, { recursive: true });
      const { service } = await setup();
      const added = data(await service.systems.add({ path: lib, thread: T1 }));
      data(await service.systems.review(added.system.id, { kind: "confirm" }));
      data(await service.newSession({ title: "Chores", brief: "", thread: T1, projectPath: null, system: { kind: "named", ref: "@fixture/kit" } }));
      const first = data(await service.commit({ session: S, thread: T1, files: files(null, { a: listTsx, b: badgeTsx }, ["Badge", "ChoreList", "ChoreRow"]), addresses: [], note: null }));
      expect(first.warnings).toEqual([]);

      // A branch the app narrows from iteration 1 carries the same.
      data(await service.branch(S, { from: 1 as IterationN, marks: { ...NONE, mains: { ["home" as SlotId]: "a" as VariantKey } }, instruction: null }));
      expect(data(await service.view(F)).iteration?.proposed.map((p) => [p.name, p.usedBy])).toEqual([
        ["ChoreList", ["home/a"]],
        ["ChoreRow", []],
      ]);

      data(await service.act(S, { kind: "approve", blockId: "home/a" as BlockId }));
      data(await service.act(S, { kind: "confirm" }));
      const view = data(await service.view(S));
      expect([view.iteration?.n, view.iteration?.blocks.map((b) => b.id), view.iteration?.proposed.map((p) => p.name)]).toEqual([2, ["home/a"], ["ChoreList", "ChoreRow"]]);

      const pulled = data(await service.pull(S)).files;
      expect(Object.keys(pulled).filter((path) => path.startsWith("proposed/")).sort()).toEqual([
        "proposed/ChoreList/component.json",
        "proposed/ChoreList/component.tsx",
        "proposed/ChoreRow/component.json",
        "proposed/ChoreRow/component.tsx",
      ]);
      // The agent edits what it pulled and commits it back.
      const edited = { ...pulled, "slots/home/a/block.tsx": listTsx.replace('["Dishes"]', '["Dishes", "Bins"]') };
      expect(data(await service.commit({ session: S, thread: T1, files: edited, addresses: [], note: null })).warnings).toEqual([]);
      service.close();
    } finally {
      rmSync(lib, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("history", () => {
  test("names where each iteration came from, and a past iteration reads as it was", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "calmer" }));
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/calm": { tsx: neonTsx, json: calmJson } }), addresses: [], note: null }));
    data(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/calm": { tsx: neonTsx.replace("Spin", "Go"), json: calmJson } }), addresses: [], note: "tidied" }));
    expect(data(await service.view(S)).history.iterations.map((i) => [i.n, i.origin])).toEqual([
      [1, { kind: "brief" }],
      [2, { kind: "request", n: 1, body: { scope: { kind: "all" }, freetext: "calmer" }, changed: [], kept: [] }],
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
    expect(data(await service.view(S)).history.iterations.map((i) => i.origin)[1]).toEqual({ kind: "request", n: 1, body: { scope: { kind: "all" }, freetext: null }, changed: ["Neon wheel"], kept: [] });
  });
});
