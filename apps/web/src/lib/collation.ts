import { i18n } from '@tracearr/translations';

let cached: { language: string; collator: Intl.Collator } | null = null;

function collator(): Intl.Collator {
  const language = i18n.language || 'en';
  if (!cached || cached.language !== language) {
    cached = {
      language,
      collator: new Intl.Collator(language, { sensitivity: 'base', numeric: true }),
    };
  }
  return cached.collator;
}

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Text order in the UI language; blank and missing values sort last. */
export function compareText(a: unknown, b: unknown): number {
  const left = textOf(a);
  const right = textOf(b);
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return collator().compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}
