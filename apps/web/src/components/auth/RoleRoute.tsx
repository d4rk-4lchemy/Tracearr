import { Outlet } from 'react-router';
import type { UserRole } from '@tracearr/shared';
import { useAuth } from '@/hooks/useAuth';
import { NotFound } from '@/pages/NotFound';

interface RoleRouteProps {
  roles: UserRole[];
  /** Renders the children instead of an Outlet, for a route outside the app shell. */
  children?: React.ReactNode;
}

/**
 * Gates routes by role. Other roles get the page a mistyped URL gets, so a
 * member never learns which pages exist. Sits inside ProtectedRoute, which has
 * already waited for the session.
 */
export function RoleRoute({ roles, children }: RoleRouteProps) {
  const { user } = useAuth();

  if (!user) return null;
  if (!roles.includes(user.role)) return <NotFound />;

  return children ?? <Outlet />;
}
