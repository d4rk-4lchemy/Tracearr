import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServerUserDetail } from '@tracearr/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: { name?: string }) => (vars?.name ? `${key}:${vars.name}` : key),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: { users: { updateAccess: vi.fn() }, settings: { get: vi.fn() } },
  BASE_URL: '/',
}));

vi.mock('@/lib/authClient', () => ({
  authClient: { admin: { impersonateUser: vi.fn() } },
}));

import { api } from '@/lib/api';
import { authClient } from '@/lib/authClient';
import { UserAccessControls } from './UserAccessControls';

function detail(overrides: Partial<ServerUserDetail>): ServerUserDetail {
  return {
    id: 'acc-1',
    userId: 'ident-1',
    role: 'member',
    loginAccess: 'default',
    loginCount: 7,
    lastLoginAt: '2026-10-01T15:30:00.000Z',
    ...overrides,
  } as ServerUserDetail;
}

function renderControls(user: ServerUserDetail = detail({})) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <UserAccessControls user={user} name="Dana" />
    </QueryClientProvider>
  );
}

describe('UserAccessControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.users.updateAccess).mockResolvedValue({} as never);
    globalSwitch(true);
  });

  function globalSwitch(member: boolean) {
    vi.mocked(api.settings.get).mockResolvedValue({
      loginMethods: { local: true, plex: true, oidc: true, member },
    } as never);
  }

  const accessField = () => screen.findByRole('combobox', { name: 'userDetail.access.signIn' });

  async function pickAccess(label: string) {
    await userEvent.click(await accessField());
    await userEvent.click(await screen.findByRole('option', { name: label }));
  }

  it('shows the sign-in access, role, counts and the View as button', async () => {
    renderControls();

    expect(await accessField()).toHaveTextContent('userDetail.access.signInDefault');
    expect(screen.getByRole('combobox', { name: 'userDetail.access.role' })).toHaveTextContent(
      'userDetail.access.roleMember'
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'userDetail.access.viewAsLabel:Dana' })
    ).toBeEnabled();
    expect(screen.queryByText('userDetail.access.viewAsHint')).toBeNull();
  });

  it.each([
    [true, 'userDetail.access.signInDefaultOn'],
    [false, 'userDetail.access.signInDefaultOff'],
  ])('says what default means while the global switch is %s', async (member, note) => {
    globalSwitch(member);
    renderControls();

    expect(await screen.findByText(note)).toBeInTheDocument();
  });

  it('says never when the person has not signed in', async () => {
    renderControls(detail({ lastLoginAt: null, loginCount: 0 }));

    expect(await screen.findByText('userDetail.access.never')).toBeInTheDocument();
  });

  it.each([
    ['userDetail.access.signInAllow', 'allow'],
    ['userDetail.access.signInBlock', 'block'],
  ])('patches the account row with only the access picked (%s)', async (label, loginAccess) => {
    renderControls();

    await pickAccess(label);

    await waitFor(() =>
      expect(api.users.updateAccess).toHaveBeenCalledWith('acc-1', { loginAccess })
    );
  });

  it('shows a refusal under the field and keeps the saved value', async () => {
    vi.mocked(api.users.updateAccess).mockRejectedValue(new Error('Nope'));
    renderControls(detail({ loginAccess: 'allow' }));

    await pickAccess('userDetail.access.signInBlock');

    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(await accessField()).toHaveTextContent('userDetail.access.signInAllow');
  });

  it.each([
    ['disabled', 'userDetail.access.disabled'],
    ['pending', 'userDetail.access.pending'],
  ] as const)('shows one status line and no controls for a %s account', async (role, line) => {
    renderControls(detail({ role }));

    expect(await screen.findByText(line)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /viewAs/ })).toBeNull();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('starts viewing as the identity, not the account row', async () => {
    vi.mocked(authClient.admin.impersonateUser).mockResolvedValue({
      data: {},
      error: null,
    } as never);
    renderControls();

    await userEvent.click(
      await screen.findByRole('button', { name: 'userDetail.access.viewAsLabel:Dana' })
    );

    await waitFor(() =>
      expect(authClient.admin.impersonateUser).toHaveBeenCalledWith({ userId: 'ident-1' })
    );
  });

  it('shows why viewing failed under the button', async () => {
    vi.mocked(authClient.admin.impersonateUser).mockResolvedValue({
      data: null,
      error: { message: 'Cannot view this user', status: 403, statusText: 'Forbidden' },
    } as never);
    renderControls();

    await userEvent.click(
      await screen.findByRole('button', { name: 'userDetail.access.viewAsLabel:Dana' })
    );

    expect(await screen.findByText('Cannot view this user')).toBeInTheDocument();
  });
});
