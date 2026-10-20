import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Play } from 'lucide-react';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('fills its grid cell on the kpi variant, so tiles in one row share a height', () => {
    render(<StatCard label="Hours watched" value="182h" variant="kpi" />);
    const tile = screen.getByText('182h').closest('div.bg-card-raised');
    expect(tile).toHaveClass('h-full');
    expect(tile).not.toHaveClass('self-start');
  });

  it('keeps a linked kpi tile full height through its link', () => {
    render(
      <MemoryRouter>
        <StatCard label="Plays" value="12" variant="kpi" href="/history" />
      </MemoryRouter>
    );
    expect(screen.getByRole('link')).toHaveClass('h-full');
  });

  it('draws a larger icon chip on the kpi variant with the kpi typography', () => {
    const { container } = render(<StatCard label="Plays" value="12" variant="kpi" icon={Play} />);
    const chip = container.querySelector('.bg-primary\\/10');
    expect(chip).toHaveClass('size-11');
    expect(chip?.querySelector('svg')).toHaveClass('size-5');
    expect(screen.getByText('Plays')).toHaveClass('uppercase');
  });

  it('keeps the default variant chip at its Dashboard size', () => {
    const { container } = render(<StatCard label="Plays" value="12" icon={Play} />);
    const chip = container.querySelector('.bg-primary\\/10');
    expect(chip).toHaveClass('h-9', 'w-9');
    expect(chip?.querySelector('svg')).toHaveClass('h-4', 'w-4');
  });

  it('tightens padding and the value size on a compact kpi tile', () => {
    render(<StatCard label="Plays" value="12" variant="kpi" compact />);
    expect(screen.getByText('12').closest('div.bg-card-raised')).toHaveClass('p-[10px_12px]');
    expect(screen.getByText('12')).toHaveClass('text-[20px]');
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

  it('renders a positive delta green with its label as the sub-value', () => {
    render(<StatCard label="Plays" value={85} delta={{ value: 12, label: 'vs prior 30d' }} />);
    expect(screen.getByText('+12%')).toHaveClass('text-success');
    expect(screen.getByText('(vs prior 30d)')).toBeInTheDocument();
  });

  it('renders a negative delta red and a zero delta muted', () => {
    render(
      <>
        <StatCard label="Down" value={1} delta={{ value: -8 }} />
        <StatCard label="Flat" value={2} delta={{ value: 0 }} />
      </>
    );
    expect(screen.getByText(/^[-\u2212]8%$/)).toHaveClass('text-destructive');
    expect(screen.getByText('0%')).toHaveClass('text-muted-foreground');
  });

  it('renders the value suffix in muted text after the value', () => {
    render(<StatCard label="Active" value={25} valueSuffix="of 43" />);
    expect(screen.getByText('of 43')).toHaveClass('text-muted-foreground');
  });

  it('renders the delta and suffix on the kpi variant too', () => {
    render(
      <StatCard label="Plays" value={85} variant="kpi" valueSuffix="of 90" delta={{ value: 5 }} />
    );
    expect(screen.getByText('of 90')).toBeInTheDocument();
    expect(screen.getByText('+5%')).toHaveClass('text-success');
  });
});
