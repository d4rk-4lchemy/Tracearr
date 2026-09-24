import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initI18n } from '@tracearr/translations';
import { i18n } from '@/i18n';
import { compareText } from './collation';

describe('compareText', () => {
  beforeAll(async () => {
    await initI18n({ lng: 'en' });
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('orders case and accents with their base letter and punctuation first', () => {
    expect(['Zed', 'alice', '_x', 'Émile', 'Bob'].sort(compareText)).toEqual([
      '_x',
      'alice',
      'Bob',
      'Émile',
      'Zed',
    ]);
  });

  it('puts blank and missing values last', () => {
    expect(['Bob', null, '', undefined, 'alice'].sort(compareText)).toEqual([
      'alice',
      'Bob',
      null,
      '',
      undefined,
    ]);
  });

  it('follows the UI language', async () => {
    await i18n.changeLanguage('sv-SE');
    expect(['ö', 'z'].sort(compareText)).toEqual(['z', 'ö']);
  });
});
