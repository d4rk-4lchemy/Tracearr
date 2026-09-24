import { useTranslation } from 'react-i18next';
import { isPlacedLocal } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function LocalBadge({
  isLocal,
  country,
  className,
}: {
  isLocal: boolean;
  country: string | null;
  className?: string;
}) {
  const { t } = useTranslation('common');
  if (!isPlacedLocal({ isLocal, country })) return null;
  return (
    <Badge variant="secondary" className={cn('h-4 shrink-0 px-1 text-[10px]', className)}>
      {t('labels.local')}
    </Badge>
  );
}
