import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MostFinishedCard } from './MostFinishedCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('MostFinishedCard', () => {
  it('links each title to its media page with a proxied poster', () => {
    const { container } = render(
      <MemoryRouter>
        <MostFinishedCard
          items={[
            {
              mediaId: 'm-1',
              title: 'Severance',
              type: 'show',
              finished: 9,
              thumbPath: '/library/metadata/1/thumb',
              serverId: 'server-1',
            },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Severance/ })).toHaveAttribute('href', '/media/m-1');
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      'api/v1/images/proxy?server=server-1'
    );
  });
});
