import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isStaff } from '@tracearr/shared';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from './PageHeader';
import { SectionTabs, type SectionTab } from './SectionTabs';
import type { ParseKeys } from 'i18next';
import type { NavKey } from '@tracearr/translations';

type SectionKey = ParseKeys<['nav', 'pages']>;

export interface SectionTabDef extends Omit<SectionTab, 'label'> {
  nameKey: NavKey;
  staff?: true;
  ranged?: true;
  /** Shows the range picker to members too; `ranged` alone shows it to staff. */
  memberRanged?: true;
}

/** Drops the staff-only tabs for a member and labels the rest from their nav key. */
export function useSectionTabs(defs: SectionTabDef[]): SectionTab[] {
  const { user } = useAuth();
  const { t } = useTranslation(['nav', 'pages']);
  const staff = user !== null && isStaff(user.role);

  return defs
    .filter((def) => staff || def.staff === undefined)
    .map(({ staff: _staff, ranged: _ranged, memberRanged: _memberRanged, ...tab }) => ({
      ...tab,
      label: t(`nav:${tab.nameKey}`),
    }));
}

interface SectionLayoutProps {
  titleKey: SectionKey;
  tabs: SectionTab[];
  actions?: React.ReactNode;
  ariaLabel: string;
  outletContext?: unknown;
}

export function SectionLayout({
  titleKey,
  tabs,
  actions,
  ariaLabel,
  outletContext,
}: SectionLayoutProps) {
  const { t } = useTranslation(['nav', 'pages']);

  return (
    <>
      <PageHeader title={t(titleKey)}>
        {(tabs.length >= 2 || actions) && (
          <div className="flex flex-wrap items-end justify-between gap-x-4">
            <div className="min-w-0 flex-1">
              <SectionTabs tabs={tabs} ariaLabel={ariaLabel} />
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2 pb-2">{actions}</div>}
          </div>
        )}
      </PageHeader>
      <div className="mt-6">
        <Outlet context={outletContext} />
      </div>
    </>
  );
}
