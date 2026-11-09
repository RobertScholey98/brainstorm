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
const GONE = "77777777-7777-7777-7777-777777777777" as ThreadId;
const SHARED = "88888888-8888-8888-8888-888888888888" as ThreadId;
const APP = "99999999-9999-9999-9999-999999999999" as ThreadId;
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
  bridge.add(GONE, "proj-gone", "A project last seen in a worktree since removed");
  bridge.add(SHARED, "proj-shared", "A project Brainstorm knows only from a system");
  bridge.add(APP, "proj-app", "An app whose agent added a library from another repo by path");
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

  test("says how to use a system Brainstorm already has", async () => {
    const again = await service.systems.add({ path: kit, thread: FRESH });
    expect(again.ok ? null : again.error.message).toBe(
      `${kit} is already the design system "@fixture/kit" (${system}); sync it instead, or run brainstorm project use ${system} for this project's brainstorms to build with it`,
    );
  });

  test("refuses a system Brainstorm doesn't have, and records nothing", async () => {
    const refused = await service.setProjectSystem({ thread: GHOST, projectPath: import.meta.dirname, system: "@fixture/nope" });
    expect(refused.ok ? null : refused.error.message).toBe('no design system @fixture/nope; Brainstorm has "@fixture/kit", "@fixture/other"');
    expect(service.systems.projects().map((p) => p.id)).not.toContain("proj-ghost");
  });

  test("finds a library's project from a worktree that's gone, and a project with a system keeps it", async () => {
    const third = mkdtempSync(join(import.meta.dirname, ".kit-"));
    cpSync(join(import.meta.dirname, "kit-lib"), third, { recursive: true });
    writeFileSync(join(third, "package.json"), readFileSync(join(third, "package.json"), "utf8").replace("@fixture/kit", "@fixture/third"));
    execFileSync("git", ["init", "-q", third]);
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: third });
    const worktree = join(mkdtempSync(join(tmpdir(), "bs-gone-")), "t3-gone");
    execFileSync("git", ["worktree", "add", "-q", worktree], { cwd: third });
    try {
      // Brainstorm met the library's project only in a worktree, which T3 removes once its thread is done.
      data(await service.newSession({ title: "Gone", brief: "", thread: GONE, projectPath: worktree, system: { kind: "none" } }));
      execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: third });
      const added = data(await service.systems.add({ path: third, thread: MAIN, projectPath: import.meta.dirname })).system;
      expect([added.projectId, added.projects.map((p) => p.id)]).toEqual(["proj-gone", ["proj-gone"]]);
      // proj-a added it too, but builds with the system it had.
      expect(data(await service.projectSystem(MAIN)).system?.id).toBe(system);
    } finally {
      rmSync(third, { recursive: true, force: true });
    }
  }, 120_000);

  test("finds a library's project from a system it already has in that repo", async () => {
    // One repo with two libraries, as a monorepo's packages/ui and packages/charts would be.
    const repo = mkdtempSync(join(import.meta.dirname, ".kit-"));
    execFileSync("git", ["init", "-q", repo]);
    for (const name of ["ui", "charts"]) {
      cpSync(join(import.meta.dirname, "kit-lib"), join(repo, name), { recursive: true });
      const file = join(repo, name, "package.json");
      writeFileSync(file, readFileSync(file, "utf8").replace("@fixture/kit", `@fixture/${name}`));
    }
    try {
      // An agent on the library's project adds the first one by path, so Brainstorm has no folder for the project.
      expect(data(await service.systems.add({ path: join(repo, "ui"), thread: SHARED })).system.projectId).toBe("proj-shared");
      // An app's agent adds the second. It belongs to the project the first one did.
      const charts = data(await service.systems.add({ path: join(repo, "charts"), thread: SIDE })).system;
      expect(charts.projectId).toBe("proj-shared");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  test("doesn't give a library to a project that only added another library from its repo", async () => {
    const repo = mkdtempSync(join(import.meta.dirname, ".kit-"));
    execFileSync("git", ["init", "-q", repo]);
    for (const name of ["forms", "tables"]) {
      cpSync(join(import.meta.dirname, "kit-lib"), join(repo, name), { recursive: true });
      const file = join(repo, name, "package.json");
      writeFileSync(file, readFileSync(file, "utf8").replace("@fixture/kit", `@fixture/${name}`));
    }
    try {
      // proj-a, whose repo Brainstorm knows, adds a library from a repo whose project Brainstorm hasn't met.
      expect(data(await service.systems.add({ path: join(repo, "forms"), thread: MAIN, projectPath: import.meta.dirname })).system.projectId).toBe("proj-a");
      // The repo still has no known project, so the next library is the adding project's, not proj-a's.
      expect(data(await service.systems.add({ path: join(repo, "tables"), thread: SIDE })).system.projectId).toBe("proj-side");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 120_000);

  test("records a project's repo from its own folder, not from a library it was matched to", async () => {
    const kitRepo = (name: string) => {
      const repo = mkdtempSync(join(import.meta.dirname, ".kit-"));
      execFileSync("git", ["init", "-q", repo]);
      cpSync(join(import.meta.dirname, "kit-lib"), join(repo, name), { recursive: true });
      const file = join(repo, name, "package.json");
      writeFileSync(file, readFileSync(file, "utf8").replace("@fixture/kit", `@fixture/${name}`));
      return repo;
    };
    const lib = kitRepo("icons");
    const app = kitRepo("app-ui");
    cpSync(join(import.meta.dirname, "kit-lib"), join(lib, "motion"), { recursive: true });
    writeFileSync(join(lib, "motion", "package.json"), readFileSync(join(lib, "motion", "package.json"), "utf8").replace("@fixture/kit", "@fixture/motion"));
    try {
      // The app's agent adds a library from another repo by path, before Brainstorm knows the app's own folder.
      expect(data(await service.systems.add({ path: join(lib, "icons"), thread: APP })).system.projectId).toBe("proj-app");
      // Rob adds another library from that repo in the window, which finds proj-app through the first library.
      data(await service.systems.add({ path: join(lib, "motion") }));
      // The app's first brainstorm comes from its own repo, which is the repo Brainstorm keeps for it.
      data(await service.newSession({ title: "App", brief: "", thread: APP, projectPath: app, system: { kind: "none" } }));
      expect(data(await service.systems.add({ path: join(app, "app-ui") })).system.projectId).toBe("proj-app");
    } finally {
      rmSync(lib, { recursive: true, force: true });
      rmSync(app, { recursive: true, force: true });
    }
  }, 120_000);

  test("refuses to set a system for a project Brainstorm doesn't know", () => {
    const refused = service.systems.setProjectSystem("proj-unknown" as never, "@fixture/kit");
    expect(refused.ok ? null : refused.error).toEqual({ code: "not_found", entity: "project", message: "Brainstorm doesn't know project proj-unknown" });
    expect(service.systems.projects().map((p) => p.id)).not.toContain("proj-unknown");
  });
});
