import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const auth = vi.hoisted(() => ({
  logout: vi.fn(),
  impersonatedBy: undefined as string | undefined,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'dana', email: null, thumbUrl: null, impersonatedBy: auth.impersonatedBy },
    logout: auth.logout,
  }),
}));
vi.mock('@/components/ui/sidebar', async () => {
  const { forwardRef } = await import('react');
  return {
    SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SidebarMenuButton: forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
      ({ size: _size, ...props }: React.ComponentProps<'button'> & { size?: string }, ref) => (
        <button ref={ref} {...props} />
      )
    ),
    useSidebar: () => ({ isMobile: false }),
  };
});
vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { toast } from 'sonner';
import { NavUser } from './NavUser';

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /dana/ }));
}

describe('NavUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.impersonatedBy = undefined;
    auth.logout.mockResolvedValue(undefined);
  });

  it('offers sign out normally', async () => {
    render(<NavUser />);
    await openMenu();

    expect(await screen.findByText('common:actions.signOut')).toBeInTheDocument();
  });

  it('offers to stop viewing, not to sign out, during a preview', async () => {
    auth.impersonatedBy = 'owner-1';
    render(<NavUser />);
    await openMenu();

    expect(await screen.findByText('pages:impersonation.stopViewing')).toBeInTheDocument();
    expect(screen.queryByText('common:actions.signOut')).toBeNull();
  });

  it('tells the owner when stopping the preview failed', async () => {
    auth.impersonatedBy = 'owner-1';
    auth.logout.mockRejectedValue(new Error('Session expired'));
    render(<NavUser />);
    await openMenu();

    await userEvent.click(await screen.findByText('pages:impersonation.stopViewing'));

    expect(toast.error).toHaveBeenCalledWith('common:errors.generic', {
      description: 'Session expired',
    });
  });
});
