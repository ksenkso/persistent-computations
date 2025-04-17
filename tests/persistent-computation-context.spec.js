import { afterEach, describe, it, mock } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as v8 from 'node:v8';
import { PCContext, PCContextOptions } from '../src/index.js';
import { DEBUG_LEVEL } from '../src/utils.js';
import {
  ConfigurableComputation,
  mockTransport,
  MultiStepComputation,
  NOOP,
  OneStepComputation,
  TestTransformer,
  ThrowingComputation,
  transportWithData,
} from './utils.js';

afterEach(() => {
  OneStepComputation.dataProvider.mock.resetCalls();
  MultiStepComputation.stepOneDataProvider.mock.resetCalls();
  MultiStepComputation.stepTwoDataProvider.mock.resetCalls();
});

describe('PersistentComputationContext', () => {
  describe('Run', () => {
    it('should allow to mix classes and instances in the `run` method', async () => {
      const transport = transportWithData();
      const ctx = new PCContext({ transport });
      await ctx.run([new ConfigurableComputation(42)]);

      assert.deepEqual(ctx.getResult(ConfigurableComputation), {
        name: 'ConfigurableComputation',
        value: 42,
      });
    });
  });
  describe('Options', () => {
    it('should be able to be created with no options', () => {
      const ctx = new PCContext();

      assert.deepEqual(
        {
          fromScratch: false,
          recoveryDataLocation: path.resolve(process.cwd(), '.recovery'),
          debugLevel: DEBUG_LEVEL.NONE,
          logger: PCContextOptions.defaultOptions.logger,
          transformer: PCContextOptions.defaultOptions.transformer,
          transport: PCContextOptions.defaultOptions.transport,
        },
        ctx.options,
      );
    });

    it('should resolve recoveryDataLocation relative to current working directory', () => {
      const recoveryDataLocation = 'some/path/to/file.bin';
      const ctx = new PCContext({
        recoveryDataLocation,
      });

      assert.equal(
        path.resolve(process.cwd(), recoveryDataLocation),
        ctx.options.recoveryDataLocation,
      );
    });
  });

  describe('Recovery', () => {
    it('should try to recover if exists returns true', async () => {
      const transport = mockTransport();
      const ctx = new PCContext({ transport });
      const recovered = await ctx.maybeRecover();

      assert.equal(transport.exists.mock.calls.length, 1);
      assert.equal(transport.read.mock.calls.length, 1);
      assert.equal(recovered, true);
    });

    it('should not recover if exists returns false', async () => {
      const transport = mockTransport({ exists: false });
      const ctx = new PCContext({ transport });
      let recovered = await ctx.maybeRecover();

      assert.equal(transport.exists.mock.calls.length, 1);
      assert.equal(transport.read.mock.calls.length, 0);
      assert.equal(recovered, false);

      transport.exists = mock.fn(NOOP, () => true);
      recovered = await ctx.maybeRecover();

      assert.equal(transport.exists.mock.calls.length, 1);
      assert.equal(transport.read.mock.calls.length, 1);
      assert.equal(recovered, true);
    });

    it('should not recover if `fromScratch` options is true', async () => {
      const transport = mockTransport();
      const ctx = new PCContext({ transport, fromScratch: true });
      const recovered = await ctx.maybeRecover();

      assert.equal(transport.exists.mock.calls.length, 0);
      assert.equal(transport.read.mock.calls.length, 0);
      assert.equal(recovered, false);
    });

    it('should not recover from false values', async () => {
      const falsyValues = [null, undefined, false, '', 0, BigInt(0), -0, NaN];
      const transport = mockTransport();
      const ctx = new PCContext({ transport });

      for (const falsyValue of falsyValues) {
        transport.read = () => v8.serialize(falsyValue);
        const recovered = await ctx.maybeRecover();

        assert.equal(recovered, false);
      }
    });

    it('should not recover if recovered data was obtained with different dependencies', async () => {
      const transport = mockTransport({
        read: () => v8.serialize({ dependencies: { dep: 2 } }),
      });
      const ctx = new PCContext({ transport }, { dep: 1 });
      const recovered = await ctx.maybeRecover();

      assert.equal(transport.exists.mock.calls.length, 1);
      assert.equal(transport.read.mock.calls.length, 1);
      assert.equal(recovered, false);
    });

    it('should recalculate all steps if there is no recovered data for the calculation', async () => {
      const transport = transportWithData();
      const ctx = new PCContext({ transport });
      await ctx.run([MultiStepComputation]);

      assert.equal(MultiStepComputation.stepOneDataProvider.mock.calls.length, 1);
      assert.equal(MultiStepComputation.stepTwoDataProvider.mock.calls.length, 1);
      assert.deepEqual(ctx.getLastResult(), {
        name: 'MultiStepComputation',
        value: {
          stepOneData: MultiStepComputation.STEP_DATA[0],
          stepTwoData: MultiStepComputation.STEP_DATA[1],
        },
      });
    });

    it('should recalculate step if there is no recovered data for the exact step', async () => {
      const transport = transportWithData({
        MultiStepComputation: [MultiStepComputation.STEP_DATA[0]],
      });
      const ctx = new PCContext({ transport });
      await ctx.run([MultiStepComputation]);

      assert.equal(MultiStepComputation.stepOneDataProvider.mock.calls.length, 0);
      assert.equal(MultiStepComputation.stepTwoDataProvider.mock.calls.length, 1);
      assert.deepEqual(ctx.getLastResult(), {
        name: 'MultiStepComputation',
        value: {
          stepOneData: MultiStepComputation.STEP_DATA[0],
          stepTwoData: MultiStepComputation.STEP_DATA[1],
        },
      });
    });

    it('should not recalculate step if there is recovered data for it', async () => {
      const transport = transportWithData({ OneStepComputation: [OneStepComputation.STEP_DATA] });
      const ctx = new PCContext({ transport });
      await ctx.run([OneStepComputation]);

      assert.equal(OneStepComputation.dataProvider.mock.calls.length, 0);
      assert.deepEqual(ctx.getLastResult(), {
        name: 'OneStepComputation',
        value: OneStepComputation.STEP_DATA,
      });
    });

    it('should not recalculate step if recovered value is falsy', async () => {
      const transport = transportWithData({ MultiStepComputation: [false] });
      const ctx = new PCContext({ transport });
      await ctx.run([MultiStepComputation]);

      assert.equal(MultiStepComputation.stepOneDataProvider.mock.calls.length, 0);
      assert.equal(MultiStepComputation.stepTwoDataProvider.mock.calls.length, 1);
      assert.deepEqual(ctx.getLastResult(), {
        name: 'MultiStepComputation',
        value: {
          stepOneData: false,
          stepTwoData: MultiStepComputation.STEP_DATA[1],
        },
      });
    });
  });

  describe('Save', () => {
    it('should save when a computation run throws', async () => {
      const transport = transportWithData();
      const ctx = new PCContext({ transport });

      await assert.rejects(
        () => ctx.run([ThrowingComputation]),
        (error) => {
          assert.equal(error.name, 'ComputationFailedError');
          assert.equal(error.message.includes('ThrowingComputation'), true);
          assert.equal(error.message.includes('ComputationErrorMessage'), true);

          return true;
        },
      );

      assert.deepEqual(transport.write.mock.calls.length, 1);
    });
  });

  describe('Default FS transport', () => {
    const recoveryDataLocation = '.test-recovery-data';
    const recoveryFilePath = path.resolve(process.cwd(), recoveryDataLocation);

    afterEach(() => {
      if (fs.existsSync(recoveryFilePath)) {
        fs.unlinkSync(recoveryFilePath);
      }
    });

    it('should write recoveryData to a file and be able to recover from it', async () => {
      const ctx = new PCContext({ recoveryDataLocation });

      await assert.rejects(() => ctx.run([OneStepComputation, ThrowingComputation]));

      assert.equal(OneStepComputation.dataProvider.mock.calls.length, 1);
      assert.deepEqual(ctx.getLastResult(), {
        name: 'OneStepComputation',
        value: OneStepComputation.STEP_DATA,
      });

      OneStepComputation.dataProvider.mock.resetCalls();

      await assert.rejects(() => ctx.run([OneStepComputation, ThrowingComputation]));

      assert.equal(OneStepComputation.dataProvider.mock.calls.length, 0);
      assert.deepEqual(ctx.getLastResult(), {
        name: 'OneStepComputation',
        value: OneStepComputation.STEP_DATA,
      });
    });
  });

  describe('Transformer support', () => {
    const transformers = [
      { name: 'Custom transformer', transformer: new TestTransformer() },
      { name: 'Default transformer', transformer: undefined },
    ];
    transformers.forEach(({ name, transformer }) => {
      describe(name, () => {
        it('should use serialize method from the transformer', async () => {
          const transport = transportWithData({
            MultiStepComputation: [MultiStepComputation.STEP_DATA[0]],
          });
          const ctx = new PCContext({ transport, transformer });
          await ctx.run([MultiStepComputation]);
          await ctx.flushRecoveryData();

          if (transformer) {
            assert.equal(transformer.serialize.mock.calls.length, 1);
            assert.equal(transformer.deserialize.mock.calls.length, 1);
          } else {
            assert.equal(ctx.transformer, PCContextOptions.defaultOptions.transformer);
          }
        });
      });
    });
  });

  describe('Logging', () => {
    describe('`log` method', () => {
      it('should use logger provided in options', () => {
        const logger = {
          log: mock.fn(),
        };
        const ctx = new PCContext({ logger });
        ctx.log('test', 'some', 'args', 'here');

        assert.equal(logger.log.mock.calls.length, 1);
        assert.deepEqual(logger.log.mock.calls[0].arguments, ['test', 'some', 'args', 'here']);
      });
    });

    describe('`debug` method', () => {
      it('should call `logger.log` with `debug` when `options.debugLevel` is set to DEBUG_LEVEL.VERBOSE', () => {
        const logger = {
          log: mock.fn(),
        };
        const ctx = new PCContext({ logger, debugLevel: DEBUG_LEVEL.DEBUG });
        ctx.debug('test');

        assert.equal(logger.log.mock.calls.length, 1);
        assert.deepEqual(logger.log.mock.calls[0].arguments, ['debug', 'test']);
      });

      it('should call `logger.log` with `debug` when `options.debugLevel` is set to DEBUG_LEVEL.VERBOSE', () => {
        const logger = {
          log: mock.fn(),
        };
        const ctx = new PCContext({ logger, debugLevel: DEBUG_LEVEL.VERBOSE });
        ctx.debug('test');

        assert.equal(logger.log.mock.calls.length, 1);
        assert.deepEqual(logger.log.mock.calls[0].arguments, ['debug', 'test']);
      });

      it('should not call `logger.log` with `debug` when `options.debugLevel` is set to DEBUG_LEVEL.NONE', () => {
        const logger = {
          log: mock.fn(),
        };
        const ctx = new PCContext({ logger });
        ctx.debug('test');

        assert.equal(logger.log.mock.calls.length, 0);
      });
    });

    describe('`verbose` method', () => {
      it('should call `logger.log` with `verbose` when `options.debugLevel` is set to DEBUG_LEVEL.VERBOSE', () => {
        const logger = {
          log: mock.fn(),
        };
        const ctx = new PCContext({ logger, debugLevel: DEBUG_LEVEL.VERBOSE });
        ctx.verbose('test');

        assert.equal(logger.log.mock.calls.length, 1);
        assert.deepEqual(logger.log.mock.calls[0].arguments, ['verbose', 'test']);
      });

      it('should not call `logger.log` with `verbose` when `options.debugLevel` is set to DEBUG_LEVEL.NONE', () => {
        const logger = {
          log: mock.fn(),
        };
        const ctx = new PCContext({ logger });
        ctx.verbose('test');

        assert.equal(logger.log.mock.calls.length, 0);
      });
    });
  });

  describe('Results', () => {
    it('should save the result of each step', async () => {
      const transport = transportWithData();
      const ctx = new PCContext({ transport });
      await ctx.run([OneStepComputation, MultiStepComputation]);

      assert.deepEqual(ctx.getResult(OneStepComputation), {
        name: 'OneStepComputation',
        value: OneStepComputation.STEP_DATA,
      });
      assert.deepEqual(ctx.getResult(MultiStepComputation), {
        name: 'MultiStepComputation',
        value: {
          stepOneData: MultiStepComputation.STEP_DATA[0],
          stepTwoData: MultiStepComputation.STEP_DATA[1],
        },
      });
    });
  });
});
