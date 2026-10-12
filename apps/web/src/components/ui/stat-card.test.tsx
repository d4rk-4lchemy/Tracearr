import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('fills its grid cell height on the kpi variant, so tiles line up regardless of detail line', () => {
    render(<StatCard label="Hours watched" value="182h" variant="kpi" />);
    expect(screen.getByText('182h').closest('div.bg-card-raised')).toHaveClass('h-full');
  });

  it('does not add h-full to the default variant', () => {
    render(<StatCard label="Sessions" value="42" />);
    expect(screen.getByText('42').closest('div.bg-card')).not.toHaveClass('h-full');
  });

  it('only truncates the value when asked, so durations like 1yr 23d 4h stay whole', () => {
    render(
      <>
        <StatCard label="Time" value="1yr 23d 4h" />
        <StatCard label="Show" value="A very long show title" truncateValue />
      </>
    );
    expect(screen.getByText('1yr 23d 4h')).not.toHaveClass('truncate');
    expect(screen.getByText('A very long show title')).toHaveClass('truncate');
  });
});
