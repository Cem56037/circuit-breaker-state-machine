import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../src/core.js';

class FakeClock {
  constructor() {
    this.current = 0;
  }
  now() {
    return this.current;
  }
  advance(ms) {
    this.current += ms;
  }
}

function makeBreaker({ threshold = 2, timeout = 100, clock = new FakeClock() } = {}) {
  return { breaker: new CircuitBreaker({ failureThreshold: threshold, resetTimeoutMs: timeout, now: () => clock.now() }), clock };
}

test('starts closed and permits calls', () => {
  const { breaker } = makeBreaker();
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isCallPermitted(), true);
});

test('opens after threshold consecutive failures', () => {
  const { breaker } = makeBreaker({ threshold: 3 });
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.isCallPermitted(), true);
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isCallPermitted(), false);
});

test('success resets consecutive failure count when closed', () => {
  const { breaker } = makeBreaker({ threshold: 3 });
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordSuccess();
  assert.equal(breaker.consecutiveFailures, 0);
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, 'CLOSED');
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
});

test('success in half-open closes the breaker and resets failures', () => {
  const { breaker, clock } = makeBreaker({ threshold: 2, timeout: 100 });
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  clock.advance(100);
  assert.equal(breaker.state, 'HALF_OPEN');
  assert.equal(breaker.isCallPermitted(), true);
  breaker.recordSuccess();
  assert.equal(breaker.state, 'CLOSED');
  assert.equal(breaker.consecutiveFailures, 0);
});

test('failure in half-open reopens breaker', () => {
  const { breaker, clock } = makeBreaker({ threshold: 2, timeout: 100 });
  breaker.recordFailure();
  breaker.recordFailure();
  clock.advance(100);
  assert.equal(breaker.state, 'HALF_OPEN');
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isCallPermitted(), false);
});

test('stays open until reset timeout fully elapses', () => {
  const { breaker, clock } = makeBreaker({ threshold: 1, timeout: 50 });
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  clock.advance(49);
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isCallPermitted(), false);
  clock.advance(1);
  assert.equal(breaker.state, 'HALF_OPEN');
  assert.equal(breaker.isCallPermitted(), true);
});

test('records only one half-open probe at a time', () => {
  const { breaker, clock } = makeBreaker({ threshold: 1, timeout: 10 });
  breaker.recordFailure();
  clock.advance(10);
  assert.equal(breaker.state, 'HALF_OPEN');
  // First call is permitted and fails, which opens the breaker again.
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.isCallPermitted(), false);
});

test('failure count remains intact when opening after half-open failure', () => {
  const { breaker, clock } = makeBreaker({ threshold: 3, timeout: 10 });
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.consecutiveFailures, 3);
  clock.advance(10);
  assert.equal(breaker.state, 'HALF_OPEN');
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.consecutiveFailures, 4);
});

test('state getter triggers timeout transition without side effects', () => {
  const { breaker, clock } = makeBreaker({ threshold: 1, timeout: 20 });
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  clock.advance(20);
  assert.equal(breaker.state, 'HALF_OPEN');
  assert.equal(breaker.consecutiveFailures, 1);
});

test('constructor rejects invalid failureThreshold', () => {
  assert.throws(() => new CircuitBreaker({ failureThreshold: 0, resetTimeoutMs: 100 }), RangeError);
  assert.throws(() => new CircuitBreaker({ failureThreshold: 1.5, resetTimeoutMs: 100 }), RangeError);
  assert.throws(() => new CircuitBreaker({ failureThreshold: -1, resetTimeoutMs: 100 }), RangeError);
});

test('constructor rejects invalid resetTimeoutMs', () => {
  assert.throws(() => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: -1 }), RangeError);
  assert.throws(() => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: NaN }), RangeError);
  assert.throws(() => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: Infinity }), RangeError);
});

test('resetTimeoutMs of 0 opens and transitions to half-open on next state check', () => {
  const { breaker } = makeBreaker({ threshold: 1, timeout: 0 });
  breaker.recordFailure();
  assert.equal(breaker.state, 'HALF_OPEN');
  assert.equal(breaker.isCallPermitted(), true);
  assert.equal(breaker.state, 'HALF_OPEN');
});

test('success while open is ignored', () => {
  const { breaker } = makeBreaker({ threshold: 1, timeout: 100 });
  breaker.recordFailure();
  assert.equal(breaker.state, 'OPEN');
  breaker.recordSuccess();
  assert.equal(breaker.state, 'OPEN');
  assert.equal(breaker.consecutiveFailures, 1);
});
