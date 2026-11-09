import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
const LIB = "55555555-5555-5555-5555-555555555555" as ThreadId;
const SIDE = "66666666-6666-6666-6666-666666666666" as ThreadId;
const AT = "2026-11-09T01:00:00.000Z";

// Copies inside the repo, so each library resolves react and tailwindcss from the repo's node_modules.
const kit = mkdtempSync(join(import.meta.dirname, ".kit-"));
cpSync(join(import.meta.dirname, "kit-lib"), kit, { recursive: true });
const other = mkdtempSync(join(import.meta.dirname, ".kit-"));
cpSync(join(import.meta.dirname, "kit-lib"), other, { recursive: true });
const pkg = join(other, "package.json");
writeFileSync(pkg, readFileSync(pkg, "utf8").replace("@fixture/kit", "@fixture/other"));
// The second library is a repo of its own, as a shared UI library in another repo would be.
execFileSync("git", ["init", "-q", other]);

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
  bridge.add(LIB, "proj-lib", "The library's own project");
  bridge.add(SIDE, "proj-side", "An app that adds the library");
  let id = 0;
  service = await Brainstorm.open({
    dbPath: join(home, "brainstorm.db"),
    exportsDir: join(home, "exports"),
    bridge,
    checker,
    now: () => AT,
    newSessionId: () => `s_project${++id}` as SessionId,
  });
  // The agent adds its project's own library from the main checkout, which Brainstorm hasn't seen yet.
  system = data(await service.systems.add({ path: kit, thread: MAIN, projectPath: import.meta.dirname })).system.id;
}, 120_000);

afterAll(async () => {
  await checker.close();
  rmSync(kit, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

describe("a project's design system", () => {
  test("is the system added from the project, which is named after its repo", () => {
    const repo = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
    expect(service.systems.project("proj-a" as never).name).toBe(basename(dirname(repo)));
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

  test("belongs to the repo that holds it when an app adds a library from another repo, and both build with it", async () => {
    // Brainstorm knows the library's project from a brainstorm in its repo.
    data(await service.newSession({ title: "Library", brief: "", thread: LIB, projectPath: other, system: { kind: "none" } }));
    const second = data(await service.systems.add({ path: other, thread: SIDE })).system;
    // Promote and reviews start their threads on the system's project, so it must be the one holding the code.
    expect([second.projectId, second.projects.map((p) => p.id)]).toEqual(["proj-lib", ["proj-lib", "proj-side"]]);
    // The app keeps its own name, not the library's.
    expect(service.systems.project("proj-side" as never).name).toBeNull();
    // A project that has a system keeps it.
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
    expect(refused.ok ? null : refused.error.message).toBe('no design system @fixture/nope; Brainstorm has "@fixture/kit", "@fixture/other"');
    expect(service.systems.projects().map((p) => p.id)).not.toContain("proj-ghost");
  });
});
