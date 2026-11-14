export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export function parseInstant(value: string, label: string): number {
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return instant;
}
