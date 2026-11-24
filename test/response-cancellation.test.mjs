import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as http from '../src/window-app/http.mjs';

test('disconnect cancels an unfinished model response while normal completion does not', () => {
  for (const finished of [false, true]) {
    const response = Object.assign(new EventEmitter(), { writableEnded: finished });
    assert.equal(typeof http.responseAbortSignal, 'function');
    const signal = http.responseAbortSignal(response);
    response.emit('close');
    assert.equal(signal.aborted, !finished);
    assert.equal(response.listenerCount('close'), 0);
  }
});
