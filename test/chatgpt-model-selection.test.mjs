import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChatGPTModelSelection } from '../src/providers/chatgpt/model-selection.mjs';
import * as selection from '../src/providers/chatgpt/model-selection.mjs';

const model = webLabels => ({ webLabels });

test('ChatGPT Web picker matching is exact after harmless whitespace and case normalization', () => {
  assert.equal(resolveChatGPTModelSelection(model(['High']), ' high ').alreadySelected, true);
  assert.equal(resolveChatGPTModelSelection(model(['High']), 'Extra High').alreadySelected, false);
  assert.equal(resolveChatGPTModelSelection(model(['Pro']), 'Pro Extended').alreadySelected, false);
  assert.equal(resolveChatGPTModelSelection(model(['Thinking · High']), 'Thinking\n·  High').alreadySelected, true);
});

test('unknown or missing catalog model fails closed before a send', () => {
  for (const chosen of [null, { webLabels: [] }]) {
    assert.throws(() => resolveChatGPTModelSelection(chosen, 'Auto'), error =>
      error.code === 'CHATGPT_MODEL_UNAVAILABLE' && error.delivery === 'not_sent');
  }
  assert.equal(resolveChatGPTModelSelection({ useSessionModel: true }, 'Anything').alreadySelected, true);
});

test('omitted client model uses the explicit site default while an unknown ID is rejected', () => {
  for (const id of [null, undefined, '']) {
    assert.equal(selection.resolveChatGPTRequestedModel(id).useSessionModel, true);
  }
  assert.throws(() => selection.resolveChatGPTRequestedModel('not-a-real-model'), error =>
    error.code === 'CHATGPT_MODEL_UNAVAILABLE' && error.delivery === 'not_sent');
});
