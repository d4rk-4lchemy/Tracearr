import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BulkAction {
  /** Unique key for the action */
  key: string;
  /** Display label */
  label: string;
  /** Icon component */
  icon?: React.ReactNode;
  /** Button variant - use shadcn standard variants */
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  /** Action handler */
  onClick: () => void;
  /** Whether the action is currently loading */
  isLoading?: boolean;
  /** Whether the action is disabled */
  disabled?: boolean;
  /** Tooltip shown when the action is disabled (or on hover generally) */
  title?: string;
}

interface BulkActionsToolbarProps {
  /** Number of selected items */
  selectedCount: number;
  /** Whether "select all matching" mode is active */
  selectAllMode?: boolean;
  /** Total count when in selectAll mode */
  totalCount?: number;
  /** Available actions */
  actions: BulkAction[];
  /** Clear selection handler */
  onClearSelection: () => void;
  /** Additional CSS classes */
  className?: string;
}

export function BulkActionsToolbar({
  selectedCount,
  selectAllMode = false,
  totalCount,
  actions,
  onClearSelection,
  className,
}: BulkActionsToolbarProps) {
  if (selectedCount === 0) {
    return null;
  }

  const displayCount = selectAllMode && totalCount ? totalCount : selectedCount;
  const countLabel = selectAllMode
    ? `All ${displayCount.toLocaleString()} selected`
    : `${displayCount.toLocaleString()} selected`;

  return (
    <div
      className={cn(
        'bg-popover text-popover-foreground border-border fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
        className
      )}
    >
      <span className="text-sm font-medium">{countLabel}</span>

      <div className="bg-border h-6 w-px" />

      <div className="flex items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            variant={action.variant ?? 'secondary'}
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled || action.isLoading}
            title={action.title}
          >
            {action.icon && <span className="mr-1.5">{action.icon}</span>}
            {action.isLoading ? 'Processing...' : action.label}
          </Button>
        ))}
      </div>

      <div className="bg-border h-6 w-px" />

      <Button variant="ghost" size="sm" onClick={onClearSelection}>
        <X className="mr-1 h-4 w-4" />
        Clear
      </Button>
    </div>
  );
}
