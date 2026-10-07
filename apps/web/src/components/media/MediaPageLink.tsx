import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface MediaPageLinkProps {
  to: string | null;
  children: ReactNode;
  className?: string;
  onNavigate?: () => void;
}

/** A media title that links to its page when there is one, plain text otherwise. */
export function MediaPageLink({ to, children, className, onNavigate }: MediaPageLinkProps) {
  if (!to) return <>{children}</>;
  return (
    <Link
      to={to}
      // Titles sit inside rows and cards that open something on click of their own.
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.();
      }}
      className={cn('hover:underline', className)}
    >
      {children}
    </Link>
  );
}
