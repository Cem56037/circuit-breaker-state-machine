/**
 * Circuit breaker state machine.
 *
 * Tracks consecutive failures and transitions between CLOSED, OPEN, and
 * HALF_OPEN states. A call is permitted only when the breaker is CLOSED or
 * HALF_OPEN. The breaker opens after `failureThreshold` consecutive failures.
 * After `resetTimeoutMs`, the breaker moves to HALF_OPEN, allowing one probe
 * call. If the probe fails, the breaker re-opens; if it succeeds, the breaker
 * closes and the failure count resets.
 */

/** @typedef {'CLOSED'|'OPEN'|'HALF_OPEN'} State */

const State = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

export class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} options.failureThreshold Number of consecutive failures
   *   that opens the breaker. Must be >= 1.
   * @param {number} options.resetTimeoutMs Time in milliseconds the breaker
   *   stays OPEN before moving to HALF_OPEN. Must be >= 0.
   * @param {() => number} [options.now] Clock function returning a numeric
   *   timestamp in milliseconds. Defaults to Date.now. Inject a fake clock
   *   for deterministic tests.
   */
  constructor({ failureThreshold, resetTimeoutMs, now = Date.now }) {
    if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
      throw new RangeError('failureThreshold must be an integer >= 1');
    }
    if (!Number.isFinite(resetTimeoutMs) || resetTimeoutMs < 0) {
      throw new RangeError('resetTimeoutMs must be a finite number >= 0');
    }
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this._now = now;
    this._state = State.CLOSED;
    this._consecutiveFailures = 0;
    this._openedAt = null;
  }

  /** @returns {State} */
  get state() {
    this._transitionIfNeeded();
    return this._state;
  }

  /** @returns {number} */
  get consecutiveFailures() {
    return this._consecutiveFailures;
  }

  /**
   * Returns true if a call should be permitted in the current state.
   * If HALF_OPEN, only one probe call is allowed until success or failure.
   * This method has no side effects on the failure count.
   */
  isCallPermitted() {
    this._transitionIfNeeded();
    return this._state === State.CLOSED || this._state === State.HALF_OPEN;
  }

  /** Record a successful call. */
  recordSuccess() {
    this._transitionIfNeeded();
    if (this._state === State.CLOSED) {
      this._consecutiveFailures = 0;
    } else if (this._state === State.HALF_OPEN) {
      this._state = State.CLOSED;
      this._consecutiveFailures = 0;
      this._openedAt = null;
    }
  }

  /** Record a failed call. */
  recordFailure() {
    this._transitionIfNeeded();
    this._consecutiveFailures += 1;
    if (this._state === State.HALF_OPEN) {
      this._state = State.OPEN;
      this._openedAt = this._now();
    } else if (
      this._state === State.CLOSED &&
      this._consecutiveFailures >= this.failureThreshold
    ) {
      this._state = State.OPEN;
      this._openedAt = this._now();
    }
  }

  /**
   * Transition from OPEN to HALF_OPEN if the reset timeout has elapsed.
   * Keeps failure count intact so HALF_OPEN probe failure can re-open
   * immediately.
   */
  _transitionIfNeeded() {
    if (this._state === State.OPEN) {
      const elapsed = this._now() - this._openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        this._state = State.HALF_OPEN;
      }
    }
  }
}
