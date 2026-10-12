import type { ComponentProps, ComponentType, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LayoutBannerProps {
  variant: 'destructive' | 'warning';
  icon?: ComponentType;
  children: ReactNode;
}

/**
 * Full-width strip under the header. The Alert's own grid keeps the icon on
 * the first line of the copy, so nothing here overrides its layout; the
 * description stretches because callers put their own flex rows inside it.
 */
export function LayoutBanner({ variant, icon: Icon = AlertTriangle, children }: LayoutBannerProps) {
  return (
    <Alert variant={variant} className="rounded-none border-x-0 border-t-0">
      <Icon />
      <AlertDescription className="justify-items-stretch">{children}</AlertDescription>
    </Alert>
  );
}

/** The action beside a warning strip's copy. */
export function LayoutBannerAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      // --warning already flips per theme, so the dark: pairs the hardcoded
      // yellows needed are gone. h-7 keeps it under the strip's line height.
      className={cn('text-warning hover:bg-warning/10 hover:text-warning h-7 shrink-0', className)}
      {...props}
    />
  );
}
