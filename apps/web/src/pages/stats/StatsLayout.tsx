import { useTranslation } from 'react-i18next';
import {
  SectionLayout,
  useSectionTabs,
  type SectionTabDef,
} from '@/components/layout/SectionLayout';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { useTimeRange } from '@/hooks/useTimeRange';

const TABS: SectionTabDef[] = [
  { nameKey: 'activity', href: '/stats/activity' },
  { nameKey: 'people', href: '/stats/people', staff: true },
  { nameKey: 'devices', href: '/stats/devices', staff: true },
  { nameKey: 'bandwidth', href: '/stats/bandwidth', staff: true },
  { nameKey: 'downloads', href: '/stats/downloads', staff: true },
];

export function StatsLayout() {
  const { t } = useTranslation(['nav', 'pages']);
  const tabs = useSectionTabs(TABS);
  const { value, setValue } = useTimeRange();

  return (
    <SectionLayout
      titleKey="nav:stats"
      tabs={tabs}
      actions={<TimeRangePicker value={value} onChange={setValue} />}
      ariaLabel={t('nav:stats')}
    />
  );
}
