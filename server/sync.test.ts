import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { fakeGitHub } from "../test/fake-github.js";
import { createApp } from "./index.js";
import { git } from "./process.js";
import { Store } from "./store.js";
import { Workbench } from "./workbench.js";
import { AppError } from "./types.js";

async function getJson(url: string) {
  return new Promise<any>((resolve, reject) => {
    request(url, { headers: { host: "127.0.0.1:4311" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve(JSON.parse(body)));
    })
      .on("error", reject)
      .end();
  });
}

test("BELL's clone of a GitHub repository updates to the latest default branch; a local import is never changed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-sync-test-"));
  const github = await fakeGitHub(directory, {
    files: { "hello.ts": 'export const hello = "before";\n' },
  });
  const store = new Store(path.join(directory, "state"));
  await store.initialize();
  const workbench = new Workbench(store);
  try {
    const repo = await workbench.importRepository(github.url);
    assert.ok(workbench.managedClone(repo));
    const first = await workbench.updateRepository(repo.id);
    assert.equal(first.updated, false);
    assert.equal(first.from, first.to);
    const upstream = await github.upstreamCommit({ "hello.ts": 'export const hello = "after";\n' });
    const second = await workbench.updateRepository(repo.id);
    assert.equal(second.updated, true);
    assert.equal(second.to, upstream);
    assert.equal((await git(repo.path, ["rev-parse", "HEAD"])).stdout.trim(), upstream);
    assert.equal(
      (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).stdout.trim(),
      "main",
    );
    assert.ok(repo.updatedAt);

    // A local import is the person's own checkout.
    const local = path.join(directory, "local");
    await mkdir(local);
    await git(local, ["init", "-q", "-b", "main"]);
    await git(local, ["config", "user.name", "Local"]);
    await git(local, ["config", "user.email", "local@example.invalid"]);
    await writeFile(path.join(local, "a.txt"), "a\n");
    await git(local, ["add", "."]);
    await git(local, ["commit", "-qm", "local"]);
    const localRepo = await workbench.importRepository(local);
    assert.equal(workbench.managedClone(localRepo), false);
    const localHead = (await git(local, ["rev-parse", "HEAD"])).stdout.trim();
    await assert.rejects(
      workbench.updateRepository(localRepo.id),
      (error: AppError) => error.statusCode === 409 && /git pull/.test(error.message),
    );
    assert.equal((await git(local, ["rev-parse", "HEAD"])).stdout.trim(), localHead);

    // The list tells the UI which repositories BELL may update.
    const app = createApp(workbench, { staticDirectory: path.join(directory, "missing") });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    try {
      const { repos } = await getJson(`http://127.0.0.1:${address.port}/api/repos`);
      const updatable = Object.fromEntries(
        repos.map((entry: { id: string; updatable: boolean }) => [entry.id, entry.updatable]),
      );
      assert.deepEqual(updatable, { [repo.id]: true, [localRepo.id]: false });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    github.restore();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
