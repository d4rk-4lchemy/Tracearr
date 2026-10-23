/**
 * Shared formatting utilities for bytes and numbers. Dates, times and durations live in
 * dateFormat.ts.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Format bytes to human-readable string.
 * Supports numeric, BigInt string inputs (from database), and direct number values.
 *
 * @param bytes - Byte count (number, BigInt as string, or numeric string)
 * @param decimals - Decimal places for display (default: 1)
 * @param options.emptyValue - Custom empty value (default: '0 B')
 * @param options.minUnit - Minimum unit to display (e.g., 'GB' to skip B/KB/MB)
 */
export function formatBytes(
  bytes: number | string | null | undefined,
  decimals = 1,
  options: { emptyValue?: string; minUnit?: (typeof BYTE_UNITS)[number] } = {}
): string {
  const { emptyValue = '0 B', minUnit } = options;

  if (bytes === null || bytes === undefined) return emptyValue;

  // Handle BigInt strings from database (common for storage totals)
  let numBytes: number;
  if (typeof bytes === 'string') {
    // Try BigInt first for very large values, fall back to parseFloat
    try {
      numBytes = Number(BigInt(bytes));
    } catch {
      numBytes = parseFloat(bytes);
    }
  } else {
    numBytes = bytes;
  }

  if (isNaN(numBytes) || numBytes === 0) return emptyValue;

  const k = 1024;
  let i = Math.floor(Math.log(numBytes) / Math.log(k));
  i = Math.min(i, BYTE_UNITS.length - 1);

  // Apply minimum unit if specified
  if (minUnit) {
    const minIndex = BYTE_UNITS.indexOf(minUnit);
    if (minIndex > i) {
      i = minIndex;
    }
  }

  const value = numBytes / Math.pow(k, i);

  return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${BYTE_UNITS[i]}`;
}

/**
 * Format a number with locale-aware thousands separators.
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString();
}

/**
 * Format a percentage value.
 *
 * @param value - Percentage value (0-100 or 0-1 depending on isDecimal)
 * @param decimals - Decimal places to display
 * @param isDecimal - If true, value is 0-1; if false, value is 0-100
 */
export function formatPercent(
  value: number | null | undefined,
  decimals = 1,
  isDecimal = false
): string {
  if (value === null || value === undefined) return '-';
  const percent = isDecimal ? value * 100 : value;
  return `${percent.toFixed(decimals)}%`;
}

const COMPACT_COUNT_UNITS: [number, string][] = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'k'],
];

/**
 * Compact magnitude for counters: 1204 -> "1.2k", 3400000 -> "3.4M". Used
 * where card space is tight and exact precision doesn't matter.
 */
export function compactCount(n: number): string {
  const abs = Math.abs(n);
  for (const [threshold, suffix] of COMPACT_COUNT_UNITS) {
    if (abs >= threshold) {
      const rounded = Math.round((n / threshold) * 10) / 10;
      return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`;
    }
  }
  return String(n);
}
