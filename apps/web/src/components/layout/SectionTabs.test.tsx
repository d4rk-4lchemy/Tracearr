import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SectionTabs, type SectionTab } from './SectionTabs';

const tabs: SectionTab[] = [
  { nameKey: 'activity', label: 'Activity', href: '/stats/activity' },
  { nameKey: 'people', label: 'People', href: '/stats/people', count: 3 },
];

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/stats/activity?period=week']}>{children}</MemoryRouter>;
}

function peopleWrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/stats/people']}>{children}</MemoryRouter>;
}

describe('SectionTabs', () => {
  it('marks the current tab and carries the range onto the others', () => {
    render(<SectionTabs tabs={tabs} ariaLabel="Stats" />, { wrapper });

    expect(screen.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /People/ })).toHaveAttribute(
      'href',
      '/stats/people?period=week'
    );
  });

  it('renders the count as a pill and renders nothing for a single tab', () => {
    const { unmount } = render(<SectionTabs tabs={tabs} ariaLabel="Stats" />, { wrapper });
    expect(screen.getByText('3')).toBeInTheDocument();
    unmount();

    const { container } = render(<SectionTabs tabs={[tabs[0]!]} ariaLabel="Stats" />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('appends the count to the mobile select label', () => {
    render(<SectionTabs tabs={tabs} ariaLabel="Stats" />, { wrapper: peopleWrapper });

    expect(screen.getByRole('combobox', { name: 'Stats' })).toHaveTextContent('People (3)');
  });
});
