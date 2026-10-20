import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { StatsLayout } from './StatsLayout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const auth = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));

vi.mock('@/hooks/useTimeRange', () => ({
  useTimeRange: () => ({ value: { period: 'month' }, setValue: vi.fn(), apiParams: {} }),
}));

vi.mock('@/components/ui/time-range-picker', () => ({
  TimeRangePicker: () => <div>range picker</div>,
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/stats/activity']}>
      <Routes>
        <Route path="stats" element={<StatsLayout />}>
          <Route path="activity" element={<p>activity page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('StatsLayout', () => {
  beforeEach(() => {
    auth.role = 'owner';
  });

  it('renders the tabs and the range picker in one row under a screen-reader-only h1', () => {
    renderLayout();

    expect(screen.getByRole('heading', { level: 1, name: 'nav:stats' })).toHaveClass('sr-only');
    expect(screen.getByRole('banner')).toContainElement(screen.getByText('range picker'));
    const nav = screen.getByRole('navigation', { name: 'nav:stats' });
    for (const key of ['activity', 'people', 'devices', 'bandwidth']) {
      expect(nav).toContainElement(screen.getByRole('link', { name: `nav:${key}` }));
    }
  });

  it('renders no tab bar for a member', () => {
    auth.role = 'member';
    renderLayout();

    expect(screen.queryByRole('navigation', { name: 'nav:stats' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'nav:stats' })).toHaveClass('sr-only');
    expect(screen.getByText('range picker')).toBeInTheDocument();
  });

  it('renders the child route inside the layout', () => {
    renderLayout();

    expect(screen.getByText('activity page')).toBeInTheDocument();
  });
});
