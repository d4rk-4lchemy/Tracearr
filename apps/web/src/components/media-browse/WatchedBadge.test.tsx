import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from '@tracearr/translations';
import { WatchedBadge } from './WatchedBadge';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

describe('WatchedBadge', () => {
  it('renders the check badge with a visually-hidden "watched" label', () => {
    const { container } = render(<WatchedBadge watchedState="watched" />);
    expect(screen.getByText('Watched')).toHaveClass('sr-only');
    expect(container.querySelector('circle')).toBeNull();
  });

  it('renders a distinct partial indicator with a visually-hidden "partially watched" label', () => {
    const { container } = render(<WatchedBadge watchedState="partial" />);
    expect(screen.getByText('Partially watched')).toHaveClass('sr-only');
    expect(screen.queryByText('Watched')).not.toBeInTheDocument();
    // The partial glyph is a conic-gradient pie, not the watched state's
    // check icon.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders visually distinct markup for watched vs partial (never the same badge)', () => {
    const watched = render(<WatchedBadge watchedState="watched" />);
    const partial = render(<WatchedBadge watchedState="partial" />);
    expect(watched.container.innerHTML).not.toBe(partial.container.innerHTML);
  });

  it('renders nothing for unwatched state', () => {
    const { container } = render(<WatchedBadge watchedState="unwatched" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the partial badge as a conic-gradient pie, not a translucent fill', () => {
    const { container } = render(<WatchedBadge watchedState="partial" />);
    const badge = container.firstElementChild;
    expect(badge).toHaveStyle({
      background: 'conic-gradient(hsl(var(--success)) 0 62%, hsl(var(--muted)) 62% 100%)',
    });
  });

  it('renders the primary/teal tone with a "watched by you" label when the requester watched it', () => {
    const { container } = render(
      <WatchedBadge watchedState="watched" watchedStateSelf="watched" />
    );
    expect(screen.getByText('Watched by you')).toHaveClass('sr-only');
    expect(container.firstElementChild).toHaveClass('bg-primary');
    expect(container.firstElementChild).not.toHaveClass('bg-success');
  });

  it('renders the success/green tone with a "watched by others" label when only someone else watched it', () => {
    const { container } = render(
      <WatchedBadge watchedState="watched" watchedStateSelf="unwatched" />
    );
    expect(screen.getByText('Watched by others')).toHaveClass('sr-only');
    expect(container.firstElementChild).toHaveClass('bg-success');
    expect(container.firstElementChild).not.toHaveClass('bg-primary');
  });

  it('falls back to the single-tone "Watched" rendering when watchedStateSelf is not supplied', () => {
    const { container } = render(<WatchedBadge watchedState="watched" />);
    expect(screen.getByText('Watched')).toHaveClass('sr-only');
    expect(container.firstElementChild).toHaveClass('bg-success');
  });
});
