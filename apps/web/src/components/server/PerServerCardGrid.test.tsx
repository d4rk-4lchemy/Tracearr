import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Server } from '@tracearr/shared';
import { PerServerCardGrid } from './PerServerCardGrid';

function s(id: string, name: string, color: string | null = null): Server {
  return {
    id,
    name,
    type: 'plex',
    url: '',
    color,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('PerServerCardGrid', () => {
  it('renders the render function once per server, with each server as the argument', () => {
    const servers = [s('a', 'Plex', '#E5A00D'), s('b', 'JF', '#AA5CC3')];
    render(
      <PerServerCardGrid
        servers={servers}
        renderServer={(server) => <div data-testid={`cell-${server.id}`}>{server.name}</div>}
      />
    );
    expect(screen.getByTestId('cell-a')).toHaveTextContent('Plex');
    expect(screen.getByTestId('cell-b')).toHaveTextContent('JF');
  });

  it('renders a ServerBadge header per cell with the server name', () => {
    const servers = [s('a', 'Plex', '#E5A00D'), s('b', 'JF', '#AA5CC3')];
    render(<PerServerCardGrid servers={servers} renderServer={() => <div>content</div>} />);
    expect(screen.getAllByText('Plex')).not.toHaveLength(0);
    expect(screen.getAllByText('JF')).not.toHaveLength(0);
  });

  it('renders nothing when servers is empty', () => {
    const { container } = render(
      <PerServerCardGrid servers={[]} renderServer={() => <div>content</div>} />
    );
    expect(container.firstChild).toBeNull();
  });
});
