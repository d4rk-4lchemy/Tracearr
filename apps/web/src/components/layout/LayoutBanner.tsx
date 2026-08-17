import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

const STRIP = {
  destructive: 'bg-destructive/15',
  warning: 'bg-yellow-50/50 dark:bg-yellow-950/20',
} as const;

interface LayoutBannerProps {
  variant: keyof typeof STRIP;
  children: ReactNode;
}

/** Full-width strip under the header, icon vertically centered on the text. */
export function LayoutBanner({ variant, children }: LayoutBannerProps) {
  return (
    <Alert
      variant={variant}
      className={cn(
        'flex items-center rounded-none border-x-0 border-t-0 [&>svg]:!top-1/2 [&>svg]:!-translate-y-1/2 [&>svg+div]:!translate-y-0',
        STRIP[variant]
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="ml-2 flex-1">{children}</AlertDescription>
    </Alert>
  );
}
