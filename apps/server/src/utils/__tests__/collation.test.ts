import { describe, it, expect } from 'vitest';
import { compareNames } from '../collation.js';

describe('compareNames', () => {
  it('orders case and accents with their base letter and punctuation first', () => {
    expect(['Zed', 'alice', '_x', 'Émile', 'Bob'].sort(compareNames)).toEqual([
      '_x',
      'alice',
      'Bob',
      'Émile',
      'Zed',
    ]);
  });

  it('orders embedded numbers numerically', () => {
    expect(['Server 10', 'Server 2'].sort(compareNames)).toEqual(['Server 2', 'Server 10']);
  });

  it('never returns 0 for two different strings', () => {
    expect(compareNames('Bob', 'bob')).not.toBe(0);
  });
});
