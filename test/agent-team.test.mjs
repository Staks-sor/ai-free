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

it('normalization reports discarded agents and defaults valid roles', async () => {
  const { getTeamAgents } = await import('../src/agent-team/team-manager.mjs');
  const team = normalizeTeamConfig({ agents: [null, { id: 'bad' }, { id: 'ok', provider: 'qwen' }] });
  assert.deepEqual(team.agents, [{ id: 'ok', provider: 'qwen', model: null, role: 'assistant' }]);
  assert.equal(team.warnings.length, 2);
  assert.deepEqual(getTeamAgents(team), team.agents);
  assert.deepEqual(getTeamAgents({ agents: [] }), []);
});

it('runs at most N tasks simultaneously and retains input order', async () => {
  let active = 0, peak = 0;
  const tasks = Array.from({ length: 7 }, (_, id) => ({ id, run: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--; return id;
  } }));
  const result = await runTeamTasks(tasks, { concurrency: 2 });
  assert.equal(peak, 2); assert.equal(active, 0);
  assert.deepEqual(result.map(value => value.output), tasks.map(task => task.id));
  await assert.rejects(runTeamTasks(tasks, { concurrency: 0 }), /concurrency/);
});

it('runTeamAgents handles empty lists and preserves structured errors', async () => {
  const { runTeamAgents } = await import('../src/agent-team/team-runner.mjs');
  assert.deepEqual(await runTeamAgents([], () => assert.fail()), []);
  const error = new Error('boom');
  const results = await runTeamAgents([{ id: 'a' }, { id: 'b' }], async agent => {
    if (agent.id === 'b') throw error; return agent.id;
  }, { concurrency: 1 });
  assert.equal(results[0].output, 'a');
  assert.deepEqual(results[1].error, { message: 'boom', stack: error.stack });
});
