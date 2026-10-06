type Bundle = Record<string, unknown>;

/**
 * Crowdin exports only `_one` and `_other` for every language, but i18next looks
 * up the language's own categories (`_few`, `_many`, ...) and falls back to English
 * when one is missing. Filling the gaps from `_other` keeps the text in the user's
 * language, even where `_other` is not the grammatically right form for that count.
 */
// Hermes, the mobile app's engine, has no Intl.PluralRules. i18next then selects
// only `one` and `other` there, so those are the only categories worth filling.
function pluralCategories(lang: string): readonly string[] {
  try {
    return new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  } catch {
    return ['one', 'other'];
  }
}

export function withPluralFallbacks(lang: string, bundle: Bundle): Bundle {
  const categories = pluralCategories(lang);

  const fill = (node: Bundle): Bundle => {
    const out: Bundle = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] =
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? fill(value as Bundle)
          : value;
    }
    for (const [key, value] of Object.entries(node)) {
      if (!key.endsWith('_other') || typeof value !== 'string' || value === '') continue;
      const base = key.slice(0, -'_other'.length);
      for (const category of categories) {
        const target = `${base}_${category}`;
        if (out[target] === undefined || out[target] === '') out[target] = value;
      }
    }
    return out;
  };

  return fill(bundle);
}
