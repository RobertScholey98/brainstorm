import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import type { Result, SessionId, SystemId, ThreadId } from "../src/core/types";
import { FakeBridge } from "./fakeBridge";

// ADR 009: a project's design system, which every thread on the project builds with, in any worktree.
const checker = createChecker({ size: 2 });
const MAIN = "11111111-1111-1111-1111-111111111111" as ThreadId;
const WORKTREE = "22222222-2222-2222-2222-222222222222" as ThreadId;
const FRESH = "33333333-3333-3333-3333-333333333333" as ThreadId;
const GHOST = "44444444-4444-4444-4444-444444444444" as ThreadId;
const AT = "2026-11-09T01:00:00.000Z";

// Copies inside the repo, so each library resolves react and tailwindcss from the repo's node_modules.
const kit = mkdtempSync(join(import.meta.dirname, ".kit-"));
cpSync(join(import.meta.dirname, "kit-lib"), kit, { recursive: true });
const other = mkdtempSync(join(import.meta.dirname, ".kit-"));
cpSync(join(import.meta.dirname, "kit-lib"), other, { recursive: true });
const pkg = join(other, "package.json");
writeFileSync(pkg, readFileSync(pkg, "utf8").replace("@fixture/kit", "@fixture/other"));

let service: Brainstorm;
let system: SystemId;
let n = 0;

const data = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error, null, 2));
  return result.data;
};

const start = (thread: ThreadId, choice?: Parameters<Brainstorm["newSession"]>[0]["system"]) =>
  service.newSession({ title: `Brainstorm ${++n}`, brief: "", thread, projectPath: null, ...(choice === undefined ? {} : { system: choice }) });

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "bs-project-system-"));
  const bridge = new FakeBridge();
  bridge.add(MAIN, "proj-a", "Main checkout");
  // T3 runs a worktree thread in its own folder, but it belongs to the same project.
  bridge.add(WORKTREE, "proj-a", "Worktree");
  bridge.add(FRESH, "proj-new", "A new project");
  bridge.add(GHOST, "proj-ghost", "A project nobody set");
  let id = 0;
  service = await Brainstorm.open({
    dbPath: join(home, "brainstorm.db"),
    exportsDir: join(home, "exports"),
    bridge,
    checker,
    now: () => AT,
    newSessionId: () => `s_project${++id}` as SessionId,
  });
  system = data(await service.systems.add({ path: kit, thread: MAIN })).system.id;
}, 120_000);

afterAll(async () => {
  await checker.close();
  rmSync(kit, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

describe("a project's design system", () => {
  test("is the system added from the project", () => {
    // It awaits Rob's review, which `project show` says, since its brainstorms are refused until he confirms it.
    expect(service.systems.projects().find((p) => p.id === "proj-a")?.system).toEqual({ id: system, name: "@fixture/kit", awaitingReview: true });
    expect(service.systems.view(system)).toMatchObject({ ok: true, data: { projects: [{ id: "proj-a" }] } });
  });

  test("stops a brainstorm on the project until Rob confirms it, unless the agent asks for none", async () => {
    const refused = await start(WORKTREE);
    expect(refused.ok ? "" : refused.error.message).toBe(
      `Rob hasn't confirmed the design system "@fixture/kit" yet; he reviews a newly added system on Brainstorm's Design systems page before brainstorms can use it. It is this project's design system; pass --system none for a brainstorm without it`,
    );
    expect(data(await start(WORKTREE, { kind: "none" })).system).toBeNull();
  });

  test("is what a brainstorm in any worktree of the project builds with", async () => {
    data(await service.systems.review(system, { kind: "confirm" }));
    const made = data(await start(WORKTREE));
    expect(made.system).toEqual({ id: system, name: "@fixture/kit", n: 1, from: "project" });
    expect(data(await service.context(made.session.id, WORKTREE)).system).toMatchObject({ id: system, n: 1 });
    expect(data(await start(MAIN)).system?.from).toBe("project");
  });

  test("stays when another system is added from the same project", async () => {
    // A brainstorm on the new project records the test folder, which holds the second library. The adding thread's
    // project still wins over that folder.
    data(await service.newSession({ title: "Seen", brief: "", thread: FRESH, projectPath: import.meta.dirname, system: { kind: "none" } }));
    const second = data(await service.systems.add({ path: other, thread: MAIN })).system;
    expect([second.projectId, second.projects]).toEqual(["proj-a", []]);
    expect(data(await service.projectSystem(WORKTREE)).system).toEqual({ id: system, name: "@fixture/kit", awaitingReview: false });
  }, 120_000);

  test("gives way to a system the agent names for one brainstorm", async () => {
    data(await service.systems.review(data(service.systems.find("@fixture/other")).id, { kind: "confirm" }));
    expect(data(await start(WORKTREE, { kind: "named", ref: "@fixture/other" })).system).toMatchObject({ name: "@fixture/other", from: "named" });
    expect(data(await start(WORKTREE)).system?.name).toBe("@fixture/kit");
    const missing = await start(WORKTREE, { kind: "named", ref: "@fixture/nope" });
    expect(missing.ok ? null : missing.error.code).toBe("not_found");
  });

  test("is unset on a new project until the agent or Rob sets it", async () => {
    expect(data(await start(FRESH)).system).toBeNull();
    const folder = mkdtempSync(join(tmpdir(), "bs-fresh-"));
    const set = data(await service.setProjectSystem({ thread: FRESH, projectPath: folder, system: "@fixture/kit" }));
    expect(set).toMatchObject({ id: "proj-new", system: { id: system, name: "@fixture/kit", awaitingReview: false } });
    expect(data(await start(FRESH)).system).toMatchObject({ id: system, from: "project" });
    expect(data(service.systems.view(system)).projects.map((p) => p.id)).toEqual(["proj-a", "proj-new"]);
  });

  test("clears, and the project's brainstorms are freeform again", async () => {
    expect(data(service.systems.setProjectSystem("proj-new" as never, null)).system).toBeNull();
    expect(data(await start(FRESH)).system).toBeNull();
    expect(data(await service.projectSystem(FRESH)).system).toBeNull();
  });

  test("refuses a system Brainstorm doesn't have, and records nothing", async () => {
    const refused = await service.setProjectSystem({ thread: GHOST, projectPath: import.meta.dirname, system: "@fixture/nope" });
    expect(refused.ok ? null : refused.error.message).toBe("no design system @fixture/nope");
    expect(service.systems.projects().map((p) => p.id)).not.toContain("proj-ghost");
  });
});
