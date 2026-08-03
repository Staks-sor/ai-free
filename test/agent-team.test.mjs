import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  createTeamConfig,
  normalizeTeamConfig,
} from "../src/agent-team/team-manager.mjs";
import {
  runTeamTasks,
} from "../src/agent-team/team-runner.mjs";

describe("agent team", () => {
  it("creates a leader with helper agents", () => {
    const team = createTeamConfig({
      leader: { provider: "chatgpt", model: "gpt-5.6" },
      agents: [
        { id: "developer", provider: "deepseek", role: "developer" },
        { id: "critic", provider: "qwen", role: "reviewer" },
      ],
    });

    assert.equal(team.leader.provider, "chatgpt");
    assert.equal(team.agents.length, 2);
    assert.equal(team.enabled, true);
  });

  it("normalizes invalid team config", () => {
    const team = normalizeTeamConfig({ agents: null });
    assert.equal(team.enabled, false);
    assert.deepEqual(team.agents, []);
  });

  it("keeps failed agents from breaking team execution", async () => {
    const result = await runTeamTasks([
      {
        id: "ok",
        run: async () => "done",
      },
      {
        id: "failed",
        run: async () => {
          throw new Error("boom");
        },
      },
    ]);

    assert.equal(result.length, 2);
    assert.equal(result[0].status, "success");
    assert.equal(result[1].status, "failed");
  });
});
