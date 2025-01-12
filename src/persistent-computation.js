export class PersistentComputation {
  #hasRecoveryData = false;
  #currentStepIndex = 0;

  /**
   * @param {PersistentComputationContext} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  get hasRecoveryData() {
    return this.#hasRecoveryData;
  }

  get currentStepIndex() {
    return this.#currentStepIndex;
  }

  async run() {
    throw new Error('You should override the `run` method of `Step` in a subclass');
  }

  markRecovered() {
    this.#hasRecoveryData = true;
  }

  /**
   * All the `step` results should be V8-serializable
   */
  async step(fn) {
    if (this.ctx.hasRecoveryData(this)) {
      const result = this.ctx.getStepValue(this);
      this.#currentStepIndex += 1;

      return result;
    }

    const result = await fn();

    this.ctx.save(null, this, result);
    this.#currentStepIndex += 1;

    return result;
  }
}

export const PC = PersistentComputation;
