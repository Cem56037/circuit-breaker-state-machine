# Circuit Breaker State Machine

A small dependency-free circuit breaker that tracks consecutive failures and gates calls through CLOSED, OPEN, and HALF_OPEN states.

## Usage

```js
import { CircuitBreaker } from './src/index.js';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
});

async function callExternalService() {
  if (!breaker.isCallPermitted()) {
    throw new Error('Circuit open');
  }
  try {
    const result = await externalCall();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure();
    throw err;
  }
}
```

## Why this exists

When a dependency starts failing, hammering it with retries usually makes the
outage worse. This library opens the circuit after a configurable number of
consecutive failures, failing fast for a cool-down period. After the timeout,
one probe call is allowed. A successful probe closes the circuit; a failed
probe re-opens it.

The main trade-off is that failure counting is strictly consecutive. A single
success resets the count to zero. This keeps the state simple and predictable
but can let a flaky service slip through if failures are interspersed with
occasional successes.

## Edge cases

- The timeout is checked lazily. The state only moves from OPEN to HALF_OPEN
  when `state` or `isCallPermitted()` is accessed, or when recording a result.
- `recordSuccess()` while OPEN is ignored. The breaker must first transition
  through HALF_OPEN before a success can close it.
- A HALF_OPEN failure immediately re-opens the breaker and starts a new
  timeout.

## API

### `new CircuitBreaker({ failureThreshold, resetTimeoutMs, now? })`

- `failureThreshold` — integer ≥ 1. Number of consecutive failures that opens
  the breaker.
- `resetTimeoutMs` — finite number ≥ 0. Milliseconds to wait before allowing a
  half-open probe.
- `now` — optional clock function returning milliseconds. Defaults to
  `Date.now`. Useful for testing.

### Properties

- `state` — `'CLOSED'`, `'OPEN'`, or `'HALF_OPEN'`.
- `consecutiveFailures` — current count of consecutive failures.

### Methods

- `isCallPermitted()` — returns `true` when CLOSED or HALF_OPEN, `false` when
  OPEN.
- `recordSuccess()` — resets the failure count in CLOSED, or closes the circuit
  from HALF_OPEN.
- `recordFailure()` — increments the failure count. Opens the breaker when the
  threshold is reached in CLOSED, or re-opens from HALF_OPEN.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

