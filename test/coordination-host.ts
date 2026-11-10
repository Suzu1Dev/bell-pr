/**
 * A coordination host for tests: takes a data directory's lock under the
 * strict rule, as coordination requires (index.ts acquireWriterLock),
 * opens its coordinator (setting it up first from a setup file when the
 * directory has none) and serves the coordination routes on 127.0.0.1
 * only. It prints {"port":N} once it listens, or {"error",
 * "reason"} and exits 1 when it cannot start.
 *
 *   node --import tsx test/coordination-host.ts <dataDir> [setup.json]
 *
 * setup.json: { participants: [{ id, role }], projects: [{ id,
 * repository, branch }], tokens: "<file>" }; the tokens are written to
 * that file as { "<id>": "<token>" }.
 *
 * BELLPR_TEST_COORDINATION_CRASH=intent-saved|ref-updated kills the host
 * with SIGKILL at that step of an integration.
 * BELLPR_TEST_COORDINATION_WRITE_DELAY_MS delays every write, so a test
 * can kill the host while requests are in flight. SIGTERM closes the host:
 * it stops listening, lets requests under way finish, gives the lock up
 * and exits 0.
 */
import express from "express";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dataPaths } from "../server/config.js";
import { coordinationRouter } from "../server/coordination-routes.js";
import { Coordinator, type CoordinatorOptions, type Role } from "../server/coordination.js";
import { writeDurable } from "../server/fs-atomic.js";
import { acquireWriterLock } from "../server/index.js";
import { AppError } from "../server/types.js";

interface Setup {
  participants: { id: string; role: Role }[];
  projects: { id: string; repository: string; branch: string }[];
  tokens: string;
}

const [dataDir, setupFile] = process.argv.slice(2);
const crashAt = process.env.BELLPR_TEST_COORDINATION_CRASH;
const writeDelay = Number(process.env.BELLPR_TEST_COORDINATION_WRITE_DELAY_MS ?? 0);

async function main() {
  const lock = await acquireWriterLock(dataDir);
  const options: CoordinatorOptions = {
    dataDir,
    lock,
    write: async (file, data, opts) => {
      if (writeDelay > 0) await sleep(writeDelay);
      await writeDurable(file, data, opts);
    },
    onStep: (step) => {
      if (step === crashAt) process.kill(process.pid, "SIGKILL");
    },
  };
  let coordinator: Coordinator;
  if (existsSync(dataPaths(dataDir).coordination) || !setupFile)
    coordinator = await Coordinator.open(options);
  else {
    const setup = JSON.parse(await readFile(setupFile, "utf8")) as Setup;
    coordinator = await Coordinator.create(options);
    const tokens: Record<string, string> = {};
    for (const participant of setup.participants)
      tokens[participant.id] = (await coordinator.addParticipant(participant.id, participant.role)).token;
    for (const project of setup.projects)
      await coordinator.defineProject(project.id, project.repository, project.branch);
    await writeFile(setup.tokens, JSON.stringify(tokens), { mode: 0o600 });
  }
  const app = express();
  app.use("/api/coordination", coordinationRouter(coordinator));
  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object")
      process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
  });
  process.once("SIGTERM", () => {
    server.close(() => {
      lock.release();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
}

main().catch((error: unknown) => {
  const reason =
    error instanceof AppError ? error.details?.reason : (error as Error)?.constructor?.name;
  process.stdout.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error), reason })}\n`,
  );
  process.exit(1);
});
