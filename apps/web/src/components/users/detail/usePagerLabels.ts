import { useTranslation } from 'react-i18next';
import type { DataTablePagerLabels } from '@/components/ui/data-table';

export function usePagerLabels(page: number, pageCount: number): DataTablePagerLabels {
  const { t } = useTranslation('common');
  return {
    navigation: t('table.pagination'),
    status: t('table.pageOf', { page, total: pageCount }),
    previous: t('actions.previous'),
    next: t('actions.next'),
  };
}
