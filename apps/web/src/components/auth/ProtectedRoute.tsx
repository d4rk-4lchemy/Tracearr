import { Navigate, useLocation } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Wraps routes that require authentication. Only a confirmed sign-out goes to
 * /login: a session check with no answer yet (a 429, or a query paused while
 * the health probe fails) keeps waiting, or the user lands on the dashboard
 * after login instead of the page they asked for.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isSignedOut } = useAuth();
  const location = useLocation();

  if (isSignedOut) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
