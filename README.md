# Persistent computations

A library for building chains of computations where each step can be persisted and recovered on the next run.

The data is serialized and recovered using `serialize` and `deserialize` functions from the `v8` module.
[Read more](https://nodejs.org/api/v8.html#serialization-api) about serialization in V8.

## Basic usage

```javascript
import { PersistentComputation, PersistentComputationContext } from 'persistent-computations';
// or you can use shorter exports
// import { PC, PCContext } from 'persistent-computations';

class OneStepOperation extends PersistentComputation {
  async run() {
    const data = await this.step(() => 'foo');

    // Any computation you don't want persisted - do it outside of `this.step` call
    return data.repeat(3);
  }
}

class TwoStepOperation extends PersistentComputation {
  async run() {
    // The value returned in the step's callback should be V8-serializable
    const firstStep = await this.step(async () => ({ foo: 'foo' }));
    const secondStep = await this.step(async () => ({ bar: 'bar' }));
    
    return {
      firstStep,
      secondStep,
    };
  }
}

const ctx = new PersistentComputationContext();
await ctx.run([TwoStepOperation])
```