import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WhatCard } from './WhatCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('WhatCard', () => {
  it('splits plays by media type and lists the top genres', () => {
    render(
      <WhatCard
        stats={{
          mediaTypeSplit: { movie: 1, episode: 3, track: 0, other: 0 },
          topGenres: [
            { genre: 'Drama', plays: 3 },
            { genre: 'Comedy', plays: 1 },
          ],
        }}
      />
    );

    expect(screen.getByText('common:media.movie_plural')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.queryByText('common:media.track_plural')).not.toBeInTheDocument();
    expect(screen.getByText('Drama')).toBeInTheDocument();
    expect(screen.getByText('Comedy')).toBeInTheDocument();
  });
});
