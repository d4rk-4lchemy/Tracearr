import { Navigate, useLocation } from 'react-router';

export function RedirectWithSearch({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search }} replace />;
}
