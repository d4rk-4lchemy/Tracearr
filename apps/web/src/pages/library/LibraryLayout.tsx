import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isStaff, LIBRARY_MEDIA_TYPES } from '@tracearr/shared';
import { MediaTypeControl } from '@/components/layout/MediaTypeControl';
import {
  SectionLayout,
  useSectionTabs,
  type SectionTabDef,
} from '@/components/layout/SectionLayout';
import { currentTab } from '@/components/layout/SectionTabs';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { useAuth } from '@/hooks/useAuth';
import { QUALITY_MEDIA_TYPES, useMediaType, type MediaTypeOptions } from '@/hooks/useMediaType';
import { useTimeRange } from '@/hooks/useTimeRange';

const TAB_MEDIA_TYPES: Partial<Record<string, MediaTypeOptions>> = {
  mediaGenres: LIBRARY_MEDIA_TYPES,
  quality: QUALITY_MEDIA_TYPES,
};

const TABS: SectionTabDef[] = [
  { nameKey: 'overview', href: '/library', end: true, ranged: true },
  { nameKey: 'mediaGenres', href: '/library/genres', ranged: true, memberRanged: true },
  { nameKey: 'quality', href: '/library/quality', staff: true, ranged: true },
  { nameKey: 'storage', href: '/library/storage', staff: true, ranged: true },
  { nameKey: 'watch', href: '/library/watch', staff: true, ranged: true },
];

export function LibraryLayout() {
  const { t } = useTranslation(['nav', 'pages']);
  const { user } = useAuth();
  const { pathname } = useLocation();
  const tabs = useSectionTabs(TABS);
  const { value, setValue } = useTimeRange();
  const tab = currentTab(TABS, pathname);
  const typeOptions = tab ? TAB_MEDIA_TYPES[tab.nameKey] : undefined;
  const mediaType = useMediaType(typeOptions ?? LIBRARY_MEDIA_TYPES);
  const staff = user !== null && isStaff(user.role);
  const showPicker = tab?.ranged === true && (staff || tab.memberRanged === true);

  return (
    <SectionLayout
      titleKey="pages:library.title"
      tabs={tabs}
      actions={
        (showPicker || typeOptions) && (
          <>
            {typeOptions && (
              <MediaTypeControl
                value={mediaType.value}
                onChange={mediaType.setValue}
                options={typeOptions}
              />
            )}
            {showPicker && <TimeRangePicker value={value} onChange={setValue} />}
          </>
        )
      }
      ariaLabel={t('pages:library.title')}
    />
  );
}
