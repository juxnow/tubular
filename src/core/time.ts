/** Host-injected time source used for deterministic timestamps and expiry checks. */
export interface Clock {
  /** Return the current instant as a Date; consumers serialize UTC timestamps and compare epoch milliseconds. */
  now(): Date;
}

/** Production wall-clock adapter returning the current system instant without persistence or monotonic guarantees. */
export class SystemClock implements Clock {
  /** Read the host wall clock; tests should inject a deterministic Clock instead. */
  now(): Date {
    return new Date();
  }
}

/** Parse a timestamp with Date.parse and return epoch milliseconds; throw on invalid input. The parser accepts more than strict ISO 8601. */
export function parseInstant(value: string, label: string): number {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return instant;
}
