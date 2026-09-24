/**
 * Name order for lists the server sorts in JS. Node ships full ICU, so this
 * resolves to en-US on every image, which the database collation does not.
 */
const nameCollator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });

export function compareNames(a: string, b: string): number {
  return nameCollator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
