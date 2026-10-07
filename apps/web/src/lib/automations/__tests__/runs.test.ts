import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '@tracearr/translations';
import type { ConditionEvidence } from '@tracearr/shared';
import type { Translate } from '../conditionFields';
import type { DescribeRefs } from '../describe';
import { conditionText, evidenceValueText } from '../runs';

let t: Translate;

beforeAll(async () => {
  await initI18n({ lng: 'en' });
  t = i18n.getFixedT(null, 'pages');
});

const refs: DescribeRefs = {
  users: { 'u-1': 'Chadowp', 'u-2': 'Ann', 'u-3': 'Bea', 'u-4': 'Cy' },
  servers: { 'srv-1': 'Basement' },
  countries: { US: 'United States', CA: 'Canada' },
};

function evidence(overrides: Partial<ConditionEvidence>): ConditionEvidence {
  return {
    field: 'user_id',
    operator: 'not_in',
    threshold: [],
    actual: null,
    matched: true,
    ...overrides,
  };
}

describe('conditionText', () => {
  it('names the users a user condition lists by id', () => {
    expect(conditionText(t, evidence({ threshold: ['u-1', 'u-2'] }), refs)).toBe(
      'User is not one of Chadowp, Ann'
    );
  });

  it('names the server and the countries', () => {
    expect(
      conditionText(t, evidence({ field: 'server_id', operator: 'eq', threshold: 'srv-1' }), refs)
    ).toBe('Server equals Basement');
    expect(
      conditionText(
        t,
        evidence({ field: 'country', operator: 'in', threshold: ['US', 'CA'] }),
        refs
      )
    ).toBe('Country is one of United States, Canada');
  });

  it('keeps the raw id when no name is known for it', () => {
    expect(conditionText(t, evidence({ threshold: ['u-1', 'gone'] }), refs)).toBe(
      'User is not one of Chadowp, gone'
    );
  });

  it('caps a long list the way the sentence does', () => {
    expect(conditionText(t, evidence({ threshold: ['u-1', 'u-2', 'u-3', 'u-4'] }), refs)).toBe(
      'User is not one of Chadowp, Ann, Bea...'
    );
  });
});

describe('evidenceValueText', () => {
  it('names the server a reading holds by id, and leaves a stored name alone', () => {
    expect(evidenceValueText(t, refs, 'server_id', 'srv-1')).toBe('Basement');
    expect(evidenceValueText(t, refs, 'user_id', 'Chadowp')).toBe('Chadowp');
  });
});
