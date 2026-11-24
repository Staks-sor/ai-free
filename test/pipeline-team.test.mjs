import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";

import {
  buildPipelineCoordinatorPrompt,
  buildPipelineAcceptancePrompt,
  buildPipelineDeveloperSystemPrompt,
  buildPipelineMemoryItem,
  buildPipelineStepInput,
  buildPipelineSynthesisPrompt,
  buildPipelineTeamPlan,
  isPipelineTeamIntrospection,
  normalizePipelineAgents,
  parsePipelineAssignments,
  parsePipelineAcceptance,
} from "../src/agent-runtime/pipeline-team.mjs";

describe("single-chat agent team", () => {
  it("keeps ordered roles on one conversation", () => {
    const agents = normalizePipelineAgents([
      { id: "architect", roleId: "architect" },
      { id: "developer", roleId: "developer" },
      { id: "reviewer", roleId: "reviewer" },
    ]);
    const plan = buildPipelineTeamPlan({
      id: "chat-1",
      provider: "qwen",
      model: "qwen3.8-max-preview",
      roleId: "assistant",
      pipelineAgents: agents,
    });

    assert.deepEqual(plan.map((step) => step.roleId), ["architect", "developer", "reviewer"]);
    assert.deepEqual(new Set(plan.map((step) => step.conversationId)), new Set(["chat-1"]));
    assert.ok(plan.every((step) => step.provider === "qwen" && step.model === "qwen3.8-max-preview"));
  });

  it("deduplicates invalid agent records without creating conversations", () => {
    const agents = normalizePipelineAgents([
      { id: "same", roleId: "developer" },
      { id: "same", roleId: "reviewer" },
      null,
      { id: "tester", roleId: "tester" },
    ]);

    assert.deepEqual(agents.map((agent) => agent.id), ["same", "tester"]);
    assert.deepEqual(agents.map((agent) => agent.roleId), ["developer", "tester"]);
  });

  it("keeps a dedicated DeepSeek model on an analyst working for a GLM chat", () => {
    const [agent] = normalizePipelineAgents([
      {
        id: "analysis-agent",
        roleId: "analyst",
        provider: "deepseek",
        model: "deepseek-v4-flash",
      },
    ]);
    const [step] = buildPipelineTeamPlan({
      id: "glm-chat",
      provider: "glm",
      model: "glm-5.3-flash",
      pipelineAgents: [agent],
    });

    assert.deepEqual(step, {
      id: "analysis-agent",
      roleId: "analyst",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      conversationId: "glm-chat",
    });
  });

  it("lets the main model delegate a focused task to a configured agent", () => {
    const plan = buildPipelineTeamPlan({
      id: "glm-chat",
      provider: "glm",
      model: "glm-5.3-flash",
      pipelineAgents: [{
        id: "analysis-agent",
        roleId: "analyst",
        provider: "deepseek",
        model: "deepseek-v4-flash",
      }],
    });
    const prompt = buildPipelineCoordinatorPrompt({
      leaderProvider: "glm",
      leaderModel: "glm-5.3-flash",
      userTask: "Проанализируй риски подписки",
      plan,
    });

    assert.match(prompt, /GLM.*glm-5\.3-flash/i);
    assert.match(prompt, /analysis-agent.*DeepSeek.*deepseek-v4-flash/is);
    assert.match(prompt, /Проанализируй риски подписки/);

    const assignments = parsePipelineAssignments(
      '```json\n{"assignments":[{"agentId":"analysis-agent","task":"Проведи анализ рисков"}]}\n```',
      plan,
      "fallback",
    );
    assert.deepEqual(assignments, [{ ...plan[0], task: "Проведи анализ рисков" }]);
    assert.deepEqual(parsePipelineAssignments('{"assignments":[]}', plan, "fallback"), []);
    assert.deepEqual(parsePipelineAssignments("not valid coordinator JSON", plan, "fallback"), []);
  });

  it("passes earlier specialist results into the next assigned step", () => {
    const input = buildPipelineStepInput({
      goal: "Пользователь хочет готовую красивую 2D-гонку",
      task: "Создай готовую игру в рабочей папке",
      memoryContext: "- [note] Проект уже использует Canvas",
      outputs: [{
        roleId: "prompt_builder",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        text: "ГОТОВЫЙ ПРОМПТ ДЛЯ 2D ГОНКИ",
      }],
    });

    assert.match(input, /Пользователь хочет готовую красивую 2D-гонку/);
    assert.match(input, /Создай готовую игру/);
    assert.match(input, /Проект уже использует Canvas/);
    assert.match(input, /prompt_builder.*DeepSeek.*ГОТОВЫЙ ПРОМПТ ДЛЯ 2D ГОНКИ/is);
    assert.ok(input.length <= 6_000);
  });

  it("tells a developer to execute a greenfield task before discussing it", () => {
    const prompt = buildPipelineDeveloperSystemPrompt();

    assert.match(prompt, /create and modify real files/i);
    assert.match(prompt, /first response.*write_file/is);
    assert.match(prompt, /do not list the whole workspace/i);
    assert.match(prompt, /large files.*incremental/is);
    assert.match(prompt, /append_file/);
  });

  it("keeps team-status questions with the main model and gives it the exact roster", () => {
    assert.equal(isPipelineTeamIntrospection("Ты видишь своих помощников?"), true);
    assert.equal(isPipelineTeamIntrospection("Кто у тебя в команде и какие модели подключены?"), true);
    assert.equal(isPipelineTeamIntrospection("Попроси аналитика проверить риски подписки"), false);

    const plan = buildPipelineTeamPlan({
      id: "glm-chat",
      provider: "glm",
      model: "glm-5.3-flash",
      pipelineAgents: [
        { id: "analyst", roleId: "analyst", provider: "deepseek", model: "deepseek-v4-flash" },
        { id: "developer", roleId: "developer", provider: "qwen", model: "qwen3.7-plus" },
      ],
    });
    const prompt = buildPipelineSynthesisPrompt({
      userTask: "Ты видишь своих помощников?",
      outputs: [],
      plan,
      teamIntrospection: true,
    });

    assert.match(prompt, /ответь сам.*не делегируй/is);
    assert.match(prompt, /Analyst.*DeepSeek.*deepseek-v4-flash/is);
    assert.match(prompt, /Developer.*Qwen.*qwen3\.7-plus/is);
    assert.match(prompt, /не придумывай/is);
  });

  it("stores only one bounded final result, not intermediate agent chatter", () => {
    const item = buildPipelineMemoryItem({
      goal: "Спроектировать безопасный переход на подписку",
      outputs: [
        { roleId: "architect", text: "INTERMEDIATE_ARCHITECT_NOT_FOR_MEMORY" },
        { roleId: "reviewer", text: "Итог: ключи проверяются сервером, доступ закрывается после grace period." },
      ],
    });

    assert.equal(item.type, "note");
    assert.match(item.content, /Спроектировать безопасный переход/);
    assert.match(item.content, /ключи проверяются сервером/);
    assert.doesNotMatch(item.content, /INTERMEDIATE_ARCHITECT_NOT_FOR_MEMORY/);
    assert.equal(item.meta.source, "pipeline-team");
  });

  it("requires the leader to reject incomplete specialist work", () => {
    const prompt = buildPipelineSynthesisPrompt({
      userTask: "Создай гонку с кругами, дрифтом и двумя соперниками",
      outputs: [{
        roleId: "developer",
        provider: "qwen",
        model: "qwen3.8-max",
        text: "Создана игра с движением влево и вправо и препятствиями.",
      }],
    });

    assert.match(prompt, /compare.*original task/is);
    assert.match(prompt, /missing.*not complete/is);
    assert.match(prompt, /do not claim.*verified/is);
  });

  it("lets the leader return actionable acceptance feedback for an automatic retry", () => {
    const prompt = buildPipelineAcceptancePrompt({
      userTask: "Создай гонку с кругами и дрифтом",
      outputs: [
        { roleId: "prompt_builder", provider: "deepseek", model: "flash", text: "Нужно 3 круга и Space-дрифт" },
        { roleId: "developer", provider: "qwen", model: "max", text: "Сделал движение влево и вправо" },
      ],
    });

    assert.match(prompt, /original user request/i);
    assert.match(prompt, /prompt_builder.*3 круга/is);
    assert.match(prompt, /developer.*влево и вправо/is);
    assert.match(prompt, /"accepted":false/);
    assert.deepEqual(
      parsePipelineAcceptance('{"accepted":false,"feedback":"Добавь круги и дрифт"}'),
      { accepted: false, feedback: "Добавь круги и дрифт" },
    );
    assert.deepEqual(
      parsePipelineAcceptance('```json\n{"accepted":true,"feedback":""}\n```'),
      { accepted: true, feedback: "" },
    );
    assert.equal(parsePipelineAcceptance("not json"), null);
  });

  it("runs team roles through the browser providers used by existing chats", () => {
    for (const file of [
      new URL("../src/window-app/server.mjs", import.meta.url),
      new URL("../plugin-for-vscode/src/window-app/server.mjs", import.meta.url),
    ]) {
      const source = fs.readFileSync(file, "utf8");
      const step = source.match(/async function completePipelineConversation[\s\S]*?\n  function buildPipelinePrompt/);
      assert.ok(step, "pipeline step implementation must exist");
      assert.match(step[0], /\["googleai", "glm"\]\.includes\(provider\)/);
      assert.match(step[0], /conversationId:\s*null/);
      assert.match(source, /buildPipelineCoordinatorPrompt/);
      assert.match(source, /appendMessage:\s*false/);
      assert.match(source, /isPipelineTeamIntrospection\(initialPrompt\)/);
      assert.match(source, /let assignments = resume\?\.assignments \|\| \[\]/);
      assert.match(source, /leader synthesis failed[\s\S]{0,900}pipelineCoordinator:\s*true/);
      assert.match(source, /buildPipelineStepInput\(\{[\s\S]{0,200}outputs/);
      assert.match(source, /buildPipelineStepInput\(\{[\s\S]{0,300}memoryContext:\s*memory\.context/);
      assert.match(source, /step\.roleId === "developer"[\s\S]{0,200}runPipelineCodeAgent/);
      assert.match(source, /async function runPipelineCodeAgent[\s\S]{0,2500}createQwenAgentAdapter[\s\S]{0,2500}runConversationAgentTask/);
      assert.match(source, /systemPrompt:\s*buildPipelineDeveloperSystemPrompt\(\)/);
      assert.match(source, /memoryEnabled:\s*false/);
      assert.match(source, /autoSkill:\s*false/);
      assert.match(source, /buildPipelineAcceptancePrompt/);
      assert.match(source, /parsePipelineAcceptance/);
      assert.match(source, /runPipelineCodeAgent[\s\S]{0,4000}acceptance\.feedback/);
    }
  });
});
