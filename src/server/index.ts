import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { updatesOff, type AppUpdates } from "../core/appUpdate";
import { createT3Bridge } from "../core/bridge/t3";
import { Brainstorm } from "../core/brainstorm";
import { createChecker } from "../core/check";
import type { AgentBridge } from "../core/types";
import { brainstormHome, exportsDir, packageVersion, writeApi } from "./appData";
import { createHttpHandler } from "./http";

const TRACKER_MS = 3000;

export type ServerOptions = {
  /** Defaults to BRAINSTORM_HOME, then %APPDATA%\brainstorm. */
  readonly home?: string;
  readonly bridge?: AgentBridge;
  readonly trackerMs?: number;
  /** The installed app's updater; the headless server has none. */
  readonly updates?: AppUpdates;
  /** The installed app's native folder dialog, resolving to the chosen folder or null when cancelled; the headless server has none. */
  readonly pickFolder?: () => Promise<string | null>;
};

export type RunningServer = {
  /** Opens the UI: `http://127.0.0.1:<port>/#ui=<uiToken>`. */
  readonly url: string;
  readonly port: number;
  readonly uiToken: string;
  close(): Promise<void>;
};

const token = () => randomBytes(32).toString("base64url");

/** A home other than the default, which an agent in a thread the app starts can't know, since T3 gives it its own environment. */
function agentHomeOf(home: string): string | null {
  const fallback = brainstormHome({ ...process.env, BRAINSTORM_HOME: "" });
  return resolve(home).toLowerCase() === resolve(fallback).toLowerCase() ? null : resolve(home);
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const home = options.home ?? brainstormHome();
  mkdirSync(exportsDir(home), { recursive: true });
  const checker = createChecker();
  const service = await Brainstorm.open({
    dbPath: join(home, "brainstorm.db"),
    exportsDir: exportsDir(home),
    bridge: options.bridge ?? createT3Bridge(),
    checker,
    agentHome: agentHomeOf(home),
  });
  const agentToken = token();
  const uiToken = token();
  const version = packageVersion();

  let port = 0;
  const updates = options.updates ?? updatesOff("The headless server has no app to update.");
  const http = createHttpHandler({ service, agentToken, uiToken, version, updates, pickFolder: options.pickFolder ?? null },() => port);
  const server: Server = createServer(http.listener);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  writeApi(home, { port, agentToken, pid: process.pid, version, startedAt: new Date().toISOString() });

  const tracker = setInterval(() => void service.tick(), options.trackerMs ?? TRACKER_MS);
  return {
    url: `http://127.0.0.1:${port}/#ui=${uiToken}`,
    port,
    uiToken,
    async close() {
      clearInterval(tracker);
      http.closeStreams();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await checker.close();
      service.close();
    },
  };
}
