import path from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { redact } from "./process.js";
import {
  AgentSlots,
  parseActiveRunLimit,
  parseAgentProcessLimit,
} from "./agent-slots.js";
import { parseAgentTimeoutScale } from "./agent-timeouts.js";
import { parseAllowedOrigins } from "./http-guard.js";
import { createApp } from "./app.js";

export { createApp, type AppOptions } from "./app.js";

async function main() {
  const port = Number(process.env.BELLPR_PORT ?? 4311);
  const frontendPort = Number(process.env.BELLPR_FRONTEND_PORT ?? 4310);
  if (
    ![port, frontendPort].every(
      (value) => Number.isInteger(value) && value >= 1024 && value <= 65535,
    )
  )
    throw new Error(
      "BELLPR_PORT / BELLPR_FRONTEND_PORT must be between 1024 and 65535.",
    );
  const allowedOrigins = process.env.BELLPR_ALLOWED_ORIGINS ?? "";
  parseAllowedOrigins(allowedOrigins);
  const agentSlots = new AgentSlots(
    parseAgentProcessLimit(process.env.BELLPR_MAX_AGENT_PROCESSES),
  );
  const maxActiveRuns = parseActiveRunLimit(process.env.BELLPR_MAX_ACTIVE_RUNS);
  const agentTimeoutScale = parseAgentTimeoutScale(
    process.env.BELLPR_AGENT_TIMEOUT_SCALE,
  );
  const store = new Store(
    path.resolve(process.env.BELLPR_DATA_DIR ?? ".bellpr"),
  );
  await store.initialize();
  const workbench = new Workbench(store, undefined, {
    agentSlots,
    maxActiveRuns,
    agentTimeoutScale,
  });
  const app = createApp(workbench, { port, frontendPort, allowedOrigins });
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`BELL-PR → http://127.0.0.1:${port}`),
  );
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const stopped = Promise.all([
      workbench.shutdown(),
      app.locals.insights.shutdown(),
      app.locals.discovery.shutdown(),
    ]);
    server.close(() => {
      void stopped.finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    );
    process.exitCode = 1;
  });
}
