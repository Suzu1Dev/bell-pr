/**
 * A coordination client for race tests. It reads its plan from argv[2]
 * (JSON: { port, token, parallel?, requests: [{ method, path, body }] }),
 * prints "ready", waits for a "go" line on stdin so that several clients
 * start together, sends its requests (in order, or all at once with
 * `parallel`) and prints [{ status, body } | { error }] as one JSON line,
 * in request order. A request the host never answered (it was killed)
 * gives `error`.
 *
 *   node --import tsx test/coordination-client.ts '<plan>'
 */
import { createInterface } from "node:readline";

interface Plan {
  port: number;
  token: string;
  parallel?: boolean;
  requests: { method: string; path: string; body?: unknown }[];
}

const plan = JSON.parse(process.argv[2]) as Plan;
const lines = createInterface({ input: process.stdin });
lines.once("line", () => {
  lines.close();
  void run();
});
process.stdout.write("ready\n");

async function run() {
  const send = async (request: Plan["requests"][number]) => {
    try {
      const response = await fetch(`http://127.0.0.1:${plan.port}/api/coordination${request.path}`, {
        method: request.method,
        headers: { "content-type": "application/json", "x-bell-participant": plan.token },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { status: response.status, body: await response.json() };
    } catch (error) {
      return { error: String((error as Error)?.cause ?? error) };
    }
  };
  const results: unknown[] = [];
  if (plan.parallel) results.push(...(await Promise.all(plan.requests.map(send))));
  else for (const request of plan.requests) results.push(await send(request));
  process.stdout.write(`${JSON.stringify(results)}\n`);
}
