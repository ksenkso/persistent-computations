import { mock } from 'node:test';
import * as v8 from 'node:v8';
import { PersistentComputation as PC } from '../src/persistent-computation.js';
import { BaseComputationError } from '../src/errors.js';

export class OneStepComputation extends PC {
  static STEP_DATA = { data: 42 };
  static dataProvider = mock.fn(NOOP, () => OneStepComputation.STEP_DATA);

  async run() {
    return this.step(OneStepComputation.dataProvider);
  }
}

export class MultiStepComputation extends PC {
  static STEP_DATA = [
    { data: 'step one' },
    { data: 'step two' },
  ];
  static stepOneDataProvider = mock.fn(NOOP, () => MultiStepComputation.STEP_DATA[0]);
  static stepTwoDataProvider = mock.fn(NOOP, () => MultiStepComputation.STEP_DATA[1]);

  async run() {
    const stepOneData = await this.step(MultiStepComputation.stepOneDataProvider);
    const stepTwoData = await this.step(MultiStepComputation.stepTwoDataProvider);

    return {
      stepOneData,
      stepTwoData,
    };
  }
}

export class ThrowingComputation extends PC {
  async run() {
    throw new BaseComputationError('ComputationErrorMessage');
  }
}

export function mockTransport(options = {}) {
  const {
    exists = true,
    read = () => v8.serialize({ dependencies: {} }),
    write = NOOP,
  } = options;

  return {
    exists: mock.fn(NOOP, () => exists),
    read: mock.fn(NOOP, read),
    write: mock.fn(NOOP, write),
  };
}

export function transportWithData(computations = {}) {
  return mockTransport({
    read: () => v8.serialize({ dependencies: {}, computations }),
  });
}

export function NOOP() {
}

export class TestTransformer {
  serialize = mock.fn();

  deserialize = mock.fn();
}
