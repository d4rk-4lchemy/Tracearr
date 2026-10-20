/**
 * Reusable stat card component for displaying metrics.
 * Used on Dashboard and History pages.
 */

import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface StatCardProps {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  subValue?: string;
  /** Percent change against the prior period; the label names the comparison. */
  delta?: { value: number; label?: string };
  /** Muted text after the value, e.g. "of 43". */
  valueSuffix?: string;
  isLoading?: boolean;
  href?: string;
  /** Cut a long value (a show title) with an ellipsis instead of letting it overflow. */
  truncateValue?: boolean;
  /**
   * 'kpi' is the media detail unit's raised-surface treatment (uppercase label, larger value,
   * sub-value on its own line). It fills its grid cell, so every tile in a row is one height.
   */
  variant?: 'default' | 'kpi';
  /** kpi only: tighter padding and a 20px value, for tiles inside a sheet. */
  compact?: boolean;
}

const deltaFormat = new Intl.NumberFormat(undefined, {
  signDisplay: 'exceptZero',
  maximumFractionDigits: 0,
});

function deltaTone(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return 'text-success';
  if (rounded < 0) return 'text-destructive';
  return 'text-muted-foreground';
}

/** The kpi chip is larger so it spans the three-line value, label and sub-line block. */
function IconChip({ icon: Icon, large }: { icon: LucideIcon; large?: boolean }) {
  return (
    <div
      className={cn(
        'bg-primary/10 flex shrink-0 items-center justify-center rounded-md',
        large ? 'size-11' : 'h-9 w-9'
      )}
    >
      <Icon className={cn('text-primary', large ? 'size-5' : 'h-4 w-4')} />
    </div>
  );
}

function ValueExtras({
  delta,
  valueSuffix,
}: Pick<StatCardProps, 'delta' | 'valueSuffix'>): React.JSX.Element {
  return (
    <>
      {valueSuffix && (
        <span className="text-muted-foreground ml-1 text-xs font-normal">{valueSuffix}</span>
      )}
      {delta && (
        <>
          <span className={cn('ml-2 text-xs font-medium', deltaTone(delta.value))}>
            {deltaFormat.format(delta.value)}%
          </span>
          {delta.label && (
            <span className="text-muted-foreground ml-1 text-xs font-normal">({delta.label})</span>
          )}
        </>
      )}
    </>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  delta,
  valueSuffix,
  isLoading,
  href,
  truncateValue,
  variant = 'default',
  compact,
}: StatCardProps) {
  const card =
    variant === 'kpi' ? (
      <div
        className={cn(
          'bg-card-raised flex h-full items-center gap-3 rounded-[calc(var(--radius)+2px)] border',
          compact ? 'p-[10px_12px]' : 'p-[14px_16px]'
        )}
      >
        {Icon && <IconChip icon={Icon} large />}
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <>
              <Skeleton className="h-6 w-16" />
              <Skeleton className="mt-2 h-3 w-20" />
            </>
          ) : (
            <>
              <div
                className={cn(
                  'font-bold tracking-[-0.02em] tabular-nums',
                  compact ? 'text-[20px] leading-7' : 'text-[22px]'
                )}
              >
                {value}
                <ValueExtras delta={delta} valueSuffix={valueSuffix} />
              </div>
              <div className="text-muted-foreground mt-0.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                {label}
              </div>
              {subValue && <div className="text-muted-foreground mt-1 text-[11px]">{subValue}</div>}
            </>
          )}
        </div>
      </div>
    ) : (
      <div
        className={cn(
          'bg-card flex items-center gap-3 rounded-lg border p-3',
          href && 'card-hover'
        )}
      >
        {Icon && <IconChip icon={Icon} />}
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <>
              <Skeleton className="h-5 w-16" />
              <Skeleton className="mt-1 h-3 w-12" />
            </>
          ) : (
            <>
              <div
                className={cn('text-lg font-semibold tabular-nums', truncateValue && 'truncate')}
              >
                {value}
                <ValueExtras delta={delta} valueSuffix={valueSuffix} />
              </div>
              <div className="text-muted-foreground text-xs">
                {label}
                {subValue && <span className="ml-1">({subValue})</span>}
              </div>
            </>
          )}
        </div>
      </div>
    );

  return href ? (
    <Link
      to={href}
      className={cn(
        'group focus-visible:ring-ring focus-visible:ring-offset-background block rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        variant === 'kpi' && 'h-full'
      )}
    >
      {card}
    </Link>
  ) : (
    card
  );
}

// Format duration in human readable format
export function formatWatchTime(ms: number): string {
  if (!ms) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const remainingHours = hours % 24;
  const days = Math.floor(hours / 24);
  const remainingDays = days % 365;
  const years = Math.floor(days / 365);

  if (years > 0) {
    return `${years}yr ${remainingDays}d ${remainingHours}h`;
  }
  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Format large numbers with commas
export function formatNumber(n: number): string {
  return n.toLocaleString();
}
