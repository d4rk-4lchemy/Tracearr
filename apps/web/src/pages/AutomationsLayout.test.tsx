import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useOutletContext } from 'react-router';
import { AutomationsLayout, type AutomationsOutletContext } from './AutomationsLayout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));

const pendingCount = vi.hoisted(() => vi.fn<(enabled: boolean) => number>(() => 3));
vi.mock('@/hooks/queries', () => ({ usePendingViolationsCount: pendingCount }));

function RulesStub() {
  const { setActions } = useOutletContext<AutomationsOutletContext>();
  return <button onClick={() => setActions(<span>new automation</span>)}>rules page</button>;
}

function ActionsEffectStub() {
  const { setActions } = useOutletContext<AutomationsOutletContext>();
  useEffect(() => {
    setActions(<span>effect action</span>);
    return () => setActions(null);
  }, [setActions]);
  return <p>effect page</p>;
}

function NavigateButton() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate('/violations')}>go</button>;
}

function renderLayout(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AutomationsLayout />}>
          <Route path="automations" element={<RulesStub />} />
          <Route path="violations" element={<p>violations page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AutomationsLayout', () => {
  it('renders Rules and Violations with the pending count on Violations', () => {
    renderLayout('/violations');

    expect(pendingCount).toHaveBeenCalledWith(true);
    expect(screen.getByRole('heading', { level: 1, name: 'pages:automations.title' })).toHaveClass(
      'sr-only'
    );
    expect(screen.getByRole('link', { name: 'nav:rules' })).toHaveAttribute('href', '/automations');
    const violations = screen.getByRole('link', { name: /nav:violations/ });
    expect(violations).toHaveAttribute('aria-current', 'page');
    expect(within(violations).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('violations page')).toBeInTheDocument();
  });

  it('lets the child route fill the header actions', () => {
    renderLayout('/automations');

    fireEvent.click(screen.getByRole('button', { name: 'rules page' }));

    expect(within(screen.getByRole('banner')).getByText('new automation')).toBeInTheDocument();
  });

  it('clears the header actions when the child route unmounts', () => {
    render(
      <MemoryRouter initialEntries={['/effect']}>
        <Routes>
          <Route element={<AutomationsLayout />}>
            <Route path="effect" element={<ActionsEffectStub />} />
            <Route path="violations" element={<p>violations page</p>} />
          </Route>
        </Routes>
        <NavigateButton />
      </MemoryRouter>
    );

    expect(within(screen.getByRole('banner')).getByText('effect action')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(screen.getByText('violations page')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByText('effect action')).toBeNull();
  });
});
