import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert';
import { PersistentComputation, PCContext } from '../src/index.js';
import { OneStepComputation } from './utils.js';

describe('PersistentComputation', () => {
  it('should throw if the `run` method has not been overridden', async () => {
    const ctx = new PCContext();
    const step = new PersistentComputation(ctx);
    assert.rejects(() => step.run());
  });

  it('`markRecovered` should make `hasRecoveryData` return true', () => {
    const ctx = new PCContext();
    const step = new OneStepComputation(ctx);

    assert.strictEqual(step.hasRecoveryData, false);
    step.markRecovered();
    assert.strictEqual(step.hasRecoveryData, true);
  });

  describe('Step', () => {
    it('should increment `currentStepIndex`', async () => {
      const ctx = new PCContext();
      const step = new OneStepComputation(ctx);
      const stepFunction = mock.fn();

      ctx.save = mock.fn(ctx.save.bind(ctx));

      assert.strictEqual(step.currentStepIndex, 0);

      await step.step(stepFunction);

      assert.strictEqual(step.currentStepIndex, 1);
      assert.strictEqual(stepFunction.mock.calls.length, 1);
      assert.strictEqual(ctx.save.mock.calls.length, 1);
    });
  });
});
