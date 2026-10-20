import { useTranslation } from 'react-i18next';
import type { ValueCategory } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';

interface ValueCategoryBadgeProps {
  category: ValueCategory;
  suggestDeletion?: boolean;
}

const VALUE_VARIANTS: Record<ValueCategory, 'danger' | 'warning' | 'success'> = {
  low_value: 'danger', // Red - deletion candidates
  moderate_value: 'warning', // Yellow - watchlist
  high_value: 'success', // Green - valuable content
};

const VALUE_LABEL_KEYS = {
  low_value: 'library.storage.roi.category.low',
  moderate_value: 'library.storage.roi.category.moderate',
  high_value: 'library.storage.roi.category.high',
} as const satisfies Record<ValueCategory, string>;

/**
 * Badge component for ROI value category display with optional deletion suggestion.
 * Color-coded: red (low), yellow (moderate), green (high value).
 */
export function ValueCategoryBadge({ category, suggestDeletion }: ValueCategoryBadgeProps) {
  const { t } = useTranslation('pages');
  const variant = VALUE_VARIANTS[category];

  return (
    <span className="inline-flex items-center gap-2">
      <Badge variant={variant}>{t(VALUE_LABEL_KEYS[category])}</Badge>
      {suggestDeletion && (
        <span className="text-muted-foreground text-xs">
          {t('library.storage.roi.deletionSuggested')}
        </span>
      )}
    </span>
  );
}
