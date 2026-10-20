import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';

function points(container: HTMLElement) {
  return (container.querySelector('polyline')?.getAttribute('points') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((pair) => pair.split(',').map(Number));
}

describe('Sparkline', () => {
  it('draws one point per value, hidden from assistive tech', () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4, 5, 6, 7]} />);

    expect(points(container)).toHaveLength(7);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('normalizes to the largest value, which sits at the top padding', () => {
    const { container } = render(<Sparkline values={[2, 4, 8]} width={40} height={20} />);

    expect(points(container)).toEqual([
      [0, 14.25],
      [20, 10],
      [40, 1.5],
    ]);
  });

  it('draws nothing for an all-zero series', () => {
    const { container } = render(<Sparkline values={[0, 0, 0]} />);

    expect(container.querySelector('polyline')).toBeNull();
    expect(container.innerHTML).not.toContain('NaN');
  });
});
