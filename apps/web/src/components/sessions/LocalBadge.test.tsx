import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalBadge } from './LocalBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('LocalBadge', () => {
  it('marks a local session placed at its server', () => {
    render(<LocalBadge isLocal country="US" />);
    expect(screen.getByText('labels.local')).toBeInTheDocument();
  });

  it('stays hidden when the session already reads Local Network', () => {
    const { container } = render(<LocalBadge isLocal country="Local Network" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for a remote session', () => {
    const { container } = render(<LocalBadge isLocal={false} country="US" />);
    expect(container).toBeEmptyDOMElement();
  });
});
