import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title as a screen-reader-only h1', () => {
    render(<PageHeader title="Stats" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Stats' })).toHaveClass('sr-only');
  });

  it('draws the bottom border only when a controls row is present', () => {
    const { rerender } = render(<PageHeader title="Stats" />);
    expect(screen.getByRole('banner')).not.toHaveClass('border-b');

    rerender(
      <PageHeader title="Stats">
        <button>Range</button>
      </PageHeader>
    );
    expect(screen.getByRole('banner')).toHaveClass('border-b');
    expect(screen.getByRole('button', { name: 'Range' })).toBeInTheDocument();
  });
});
