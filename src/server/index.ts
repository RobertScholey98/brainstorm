import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createT3Bridge } from "../core/bridge/t3";
import { Brainstorm } from "../core/brainstorm";
import { createChecker } from "../core/check";
import type { AgentBridge } from "../core/types";
import { brainstormHome, packageVersion, writeApi } from "./appData";
import { createHttpHandler } from "./http";

const TRACKER_MS = 3000;

export type ServerOptions = {
  /** Defaults to BRAINSTORM_HOME, then %APPDATA%\brainstorm. */
  readonly home?: string;
  readonly bridge?: AgentBridge;
  readonly trackerMs?: number;
};

export type RunningServer = {
  /** Opens the UI: `http://127.0.0.1:<port>/#ui=<uiToken>`. */
  readonly url: string;
  readonly port: number;
  readonly uiToken: string;
  close(): Promise<void>;
};

const token = () => randomBytes(32).toString("base64url");

/** Starts the HTTP API, the tracker and the check pool, then writes api.json. Electron and headless both call this. */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const home = options.home ?? brainstormHome();
  mkdirSync(join(home, "exports"), { recursive: true });
  const checker = createChecker();
  const service = await Brainstorm.open({ dbPath: join(home, "brainstorm.db"), exportsDir: join(home, "exports"), bridge: options.bridge ?? createT3Bridge(), checker });
  const agentToken = token();
  const uiToken = token();
  const version = packageVersion();

  let port = 0;
  const http = createHttpHandler({ service, agentToken, uiToken, version }, () => port);
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
