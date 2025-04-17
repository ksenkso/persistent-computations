import {
  PersistentComputationContext,
  PersistentComputationContextOptions,
} from './persistent-computation-context.js';
import { BaseComputationError, ComputationFailedError } from './errors.js';
import { PersistentComputation } from './persistent-computation.js';

export {
  PersistentComputation,
  PersistentComputationContext,
  PersistentComputationContextOptions,
  BaseComputationError,
  ComputationFailedError,
};

export const PCContext = PersistentComputationContext;
export const PCContextOptions = PersistentComputationContextOptions;

export const PC = PersistentComputation;
