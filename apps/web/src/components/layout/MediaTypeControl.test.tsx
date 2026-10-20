import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LIBRARY_MEDIA_TYPES } from '@tracearr/shared';
import { MediaTypeControl } from './MediaTypeControl';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('MediaTypeControl', () => {
  it('offers movies, shows and artists and calls back with the picked type', async () => {
    const onChange = vi.fn();
    render(<MediaTypeControl value="movie" onChange={onChange} options={LIBRARY_MEDIA_TYPES} />);

    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.textContent)).toEqual([
      'common:media.movie_plural',
      'common:media.tvShows',
      'common:media.artist_plural',
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: 'common:media.artist_plural' }));
    expect(onChange).toHaveBeenCalledWith('artist');
  });

  it('renders only the options it is given', () => {
    render(<MediaTypeControl value="show" onChange={vi.fn()} options={['movie', 'show']} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('labels the all option the way Quality always has', () => {
    render(<MediaTypeControl value="all" onChange={vi.fn()} options={['all', 'movie', 'show']} />);
    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      'pages:library.quality.all',
      'common:media.movie_plural',
      'common:media.tvShows',
    ]);
  });
});
