/** Stable: the API already lists live servers first, and this keeps that when a page reorders them. */
export function liveFirst<T extends { historicalAt?: string | null }>(servers: T[]): T[] {
  return [...servers].sort((a, b) => Number(!!a.historicalAt) - Number(!!b.historicalAt));
}
