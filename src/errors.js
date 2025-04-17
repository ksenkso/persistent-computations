export class BaseComputationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BaseComputationError';
  }
}

export class ComputationFailedError extends BaseComputationError {
  step;

  constructor(error, step) {
    super(
      `Computation failed on step ${step.constructor.name} due to this error: ${error.message}`,
    );
    this.name = 'ComputationFailedError';
    this.cause = error;
    this.step = step;
  }
}
