import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ActiveSession } from '@tracearr/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

const mockUseActiveSessions = vi.fn();
vi.mock('@/hooks/queries', () => ({
  useActiveSessions: () => mockUseActiveSessions(),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ selectedServerIds: [] }),
}));

vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ isConnected: true }),
}));

import { useDocumentTitle, usePageTitle, useStreamCountTitle } from './useDocumentTitle';

function sessions(count: number): ActiveSession[] {
  return Array.from({ length: count }) as ActiveSession[];
}

/** The shell mounts the counter; the route hook owns the title, as in Layout/RootLayout */
function Shell({ ownTitle }: { ownTitle?: string }) {
  useStreamCountTitle();
  useDocumentTitle();
  usePageTitle(ownTitle);
  return null;
}

function renderShell(count: number, ownTitle?: string) {
  mockUseActiveSessions.mockReturnValue({ data: sessions(count) });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Shell ownTitle={ownTitle} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.title = '';
});

describe('document title', () => {
  it('leaves the title alone while nothing is streaming', () => {
    renderShell(0);
    expect(document.title).toBe('dashboard | Tracearr');
  });

  it('prefixes the title with the live stream count', () => {
    renderShell(3);
    expect(document.title).toBe('(3) dashboard | Tracearr');
  });

  it('drops the prefix when the last stream stops', () => {
    const { rerender } = renderShell(2);
    expect(document.title).toBe('(2) dashboard | Tracearr');

    mockUseActiveSessions.mockReturnValue({ data: sessions(0) });
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Shell />
      </MemoryRouter>
    );

    expect(document.title).toBe('dashboard | Tracearr');
  });

  it('counts down without compounding the prefix', () => {
    const { rerender } = renderShell(1);

    for (const count of [4, 2, 7]) {
      mockUseActiveSessions.mockReturnValue({ data: sessions(count) });
      rerender(
        <MemoryRouter initialEntries={['/']}>
          <Shell />
        </MemoryRouter>
      );
      expect(document.title).toBe(`(${count}) dashboard | Tracearr`);
    }
  });

  it('keeps the count on a page that names itself', () => {
    renderShell(2, 'My Automation');
    expect(document.title).toBe('(2) My Automation | Tracearr');
  });

  it('stops counting once the authenticated shell unmounts', () => {
    const { unmount } = renderShell(3);
    unmount();

    document.title = '';
    mockUseActiveSessions.mockReturnValue({ data: undefined });
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteOnly />
      </MemoryRouter>
    );

    expect(document.title).toBe('dashboard | Tracearr');
  });
});

/** The public shell: route title with no stream counter mounted */
function RouteOnly() {
  useDocumentTitle();
  return null;
}
