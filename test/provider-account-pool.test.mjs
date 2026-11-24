import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createProviderAccountPool } from "../src/providers/account-pool.mjs";

describe("provider-neutral account pool", () => {
  it("leases distinct healthy accounts to concurrent workers", async () => {
    const accounts = [
      { id: "worker-a", lastUsed: 1 },
      { id: "worker-b", lastUsed: 2 },
      { id: "limited", resetAt: "2030-01-02T00:00:00.000Z" },
    ];
    const pool = createProviderAccountPool({ now: () => Date.parse("2030-01-01T00:00:00.000Z") });
    pool.register("qwen", { listAccounts: () => accounts });

    const first = await pool.lease("qwen", { affinityKey: "project-a" });
    const second = await pool.lease("qwen", { affinityKey: "project-a" });

    assert.equal(first.account.id, "worker-a");
    assert.equal(second.account.id, "worker-b");
    assert.equal((await pool.snapshot("qwen")).filter((item) => item.busy).length, 2);

    first.release();
    second.release();
  });

  it("reuses affinity after release and excludes invalid accounts", async () => {
    const pool = createProviderAccountPool({ now: () => 1000 });
    pool.register("glm", {
      listAccounts: () => [
        { id: "broken", invalid: true },
        { id: "main", lastUsed: 1 },
        { id: "backup", lastUsed: 2 },
      ],
    });

    const first = await pool.lease("glm", { affinityKey: "chat-1" });
    assert.equal(first.account.id, "main");
    first.release();

    const repeated = await pool.lease("glm", { affinityKey: "chat-1" });
    assert.equal(repeated.account.id, "main");
    repeated.release();
  });

  it("returns null when every account is unavailable", async () => {
    const pool = createProviderAccountPool({ now: () => 1000 });
    pool.register("deepseek", {
      listAccounts: () => [{ id: "only", resetAt: new Date(2000).toISOString() }],
    });

    assert.equal(await pool.lease("deepseek"), null);
  });

  it("leases a dedicated Qwen account for each pipeline worker", () => {
    for (const file of [
      new URL("../src/window-app/server.mjs", import.meta.url),
      new URL("../plugin-for-vscode/src/window-app/server.mjs", import.meta.url),
    ]) {
      const source = fs.readFileSync(file, "utf8");
      assert.match(source, /createProviderAccountPool/);
      assert.match(source, /register\("qwen"[\s\S]{0,300}listAccounts/);
      assert.match(source, /async function leaseQwenWorkerClient/);
      assert.match(source, /runPipelineCodeAgent[\s\S]{0,1200}leaseQwenWorkerClient/);
      assert.match(source, /finally[\s\S]{0,120}workerLease\.release\(\)/);
    }
  });
});
