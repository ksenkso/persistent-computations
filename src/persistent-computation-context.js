import * as fs from 'node:fs';
import * as path from 'node:path';
import * as v8 from 'node:v8';
import { ComputationFailedError } from './errors.js';
import fastDeepEqual from 'fast-deep-equal';
import { DEBUG_LEVEL } from './utils.js';

export class PersistentComputationContextOptions {
  static defaultOptions = {
    fromScratch: false,
    recoveryDataLocation: '.recovery',
    debugLevel: DEBUG_LEVEL.NONE,
    logger: {
      log: console.log.bind(console),
    },
    transport: {
      read(fileName) {
        return fs.readFileSync(fileName);
      },
      write(fileName, data) {
        fs.writeFileSync(fileName, data);
      },
      exists(fileName) {
        return fs.existsSync(fileName);
      },
    },
    transformer: {
      serialize(value) {
        return v8.serialize(value);
      },
      deserialize(value) {
        return v8.deserialize(value);
      },
    }
  }

  static create(optionsObject) {
    const options = { ...PersistentComputationContextOptions.defaultOptions };
    for (const key in optionsObject) {
      // only add non-undefined options
      if (key in options && typeof optionsObject[key] !== 'undefined') {
        options[key] = optionsObject[key];
      }
    }

    return options;
  }
}

/**
 * @typedef {{
 *   fromScratch?: boolean,
 *   recoveryDataLocation?: string,
 *   debugLevel?: DebugLevel,
 *   logger?: {
 *     log(...args: any[]): void,
 *   },
 *   transport?: {
 *     read(fileName: string): Buffer | Promise<Buffer>,
 *     write(fileName: string, data: Buffer): void | Promise<void>,
 *   }
 * }} PCContextOptions
 */

export class PersistentComputationContext {
  #logger;
  #transport;
  #transformer;

  get transformer() {
    return this.#transformer;
  }
  /**
   * Stores the return values of each `PersistentComputation#run`.
   * Results are not persisted, because web take a more granular approach and recover each step in a computation.
   * @type {Record<string, unknown>}
   */
  #results = [];

  options;
  recoveryData = {
    computations: {},
    dependencies: {},
  };

  /**
   * @param {PCContextOptions} options
   * @param {Object} dependencies
   */
  constructor(options = {}, dependencies = {}) {
    const defaultedOptions = PersistentComputationContextOptions.create(options);
    defaultedOptions.recoveryDataLocation = path.resolve(process.cwd(), defaultedOptions.recoveryDataLocation);

    this.options = Object.freeze(defaultedOptions);
    this.#logger = defaultedOptions.logger;
    this.#transport = defaultedOptions.transport;
    this.#transformer = defaultedOptions.transformer;

    Object.assign(this.recoveryData.dependencies, { ...dependencies });
  }

  /**
   * Check if there is recovery data in recoveryDataLocation
   * If there is, read it
   * Check if the recovery data is for the same computation
   * If it is, set recovery data
   * For each step:
   *   If there is recovery data and there is data for this step:
   *     recover the step
   *   run the step
   *   If there was an error throw during recovery or run:
   *     save the step
   *     exit
   * @param {typeof PersistentComputation[]} computationClasses
   * @param {any} [input]
   * @return {Promise<void>}
   * @throws {ComputationFailedError}
   */
  async run(computationClasses, input) {
    // this.recoveryData.dependencies.computationClasses = computationClasses
    //   .map(computationClass => computationClass.name);
    const recovered = await this.maybeRecover();
    let computationValue = input;

    for (const Computation of computationClasses) {
      const computation = new Computation(this);

      try {
        if (recovered) {
          computation.markRecovered();
        }

        this.debug(`Running ${computation.constructor.name}`);
        computationValue = await computation.run(computationValue);
        this.pushResult(computation, computationValue);
      } catch (error) {
        this.debug('Failed to run computation');
        this.save(error, computation);
        await this.flushRecoveryData();

        throw new ComputationFailedError(error, computation);
      }
    }

    return this.getLastResult();
  }

  async maybeRecover() {
    const { recoveryDataLocation, fromScratch } = this.options;
    if (fromScratch) {
      this.debug('Forced to start from scratch by settings fromScratch to `true`');
      return false;
    }

    /* node:coverage ignore next 5 */
    this.debug(
      recoveryDataLocation
        ? `Trying to recover from ${recoveryDataLocation}`
        : 'Trying to recover data, no recoveryDataLocation provided',
    );

    if (!await this.#transport.exists(recoveryDataLocation)) {
      this.debug('No recovery data found');
      return false;
    }


    const data = await this.#transport.read(recoveryDataLocation);
    const recoveryData = this.#transformer.deserialize(data);


    if (!recoveryData) {
      this.debug('Recovery data object is falsy, skipping recovery');
      return false;
    }


    if (this.sameDeps(this.recoveryData.dependencies, recoveryData.dependencies)) {
      this.debug('Got the same dependencies as in the recovery data, applying');
      this.verbose(recoveryData);
      this.recoveryData = recoveryData;

      return true;
    }


    this.debug('Got different dependencies in the recovery data');
    this.verbose('Current dependencies', this.recoveryData.dependencies);
    this.verbose('Recovered dependencies', recoveryData.dependencies);

    return false;
  }

  save(error, step, result) {
    if (error) {
      this.recoveryData.error = error;
    }

    if (arguments.length === 3) {
      if (!this.recoveryData.computations[step.constructor.name]) {
        this.recoveryData.computations[step.constructor.name] = [];
      }

      this.recoveryData.computations[step.constructor.name].push(result);
    }
  }

  async flushRecoveryData() {
    await this.#transport.write(this.options.recoveryDataLocation, this.#transformer.serialize(this.recoveryData))
  }

  hasRecoveryData(computation) {
    const stepData = this.recoveryData.computations[computation.constructor.name];
    if (!stepData) {
      return false;
    }

    if (stepData.length <= computation.currentStepIndex) {
      this.verbose(`No data for step ${computation.currentStepIndex}`);
      return false;
    }
    this.verbose('Trying to recover step, found data:', stepData);

    return true;
  }

  getStepValue(computation) {
    this.verbose(`Getting recovery data for ${computation.constructor.name}, step ${computation.currentStepIndex}`);

    return this.recoveryData.computations[computation.constructor.name][computation.currentStepIndex];
  }

  sameDeps(currentDeps, recoveredDeps) {
    return fastDeepEqual(currentDeps, recoveredDeps)
  }

  debug(...args) {
    if (this.options.debugLevel >= DEBUG_LEVEL.DEBUG) {
      this.log('debug', ...args);
    }
  }

  verbose(...args) {
    if (this.options.debugLevel >= DEBUG_LEVEL.VERBOSE) {
      this.log('verbose', ...args);
    }
  }

  log(prefix, ...args) {
    this.#logger.log(prefix, ...args);
  }

  pushResult(computation, value) {
    this.#results.push({ name: computation.constructor.name, value })
  }

  getResult(computationClass) {
    return this.getResultByName(computationClass.name);
  }

  getLastResult() {
    return this.#results.at(-1);
  }

  getResultByName(computationName) {
    return this.#results.find(result => result.name === computationName);
  }
}

