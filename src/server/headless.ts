import { startServer } from "./index";

const server = await startServer();
process.stdout.write(`Brainstorm is running at ${server.url}\n`);

const stop = () => void server.close().finally(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
