import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionLayout, useSectionTabs } from '@/components/layout/SectionLayout';
import { usePendingViolationsCount } from '@/hooks/queries';

export interface AutomationsOutletContext {
  setActions: (actions: React.ReactNode) => void;
}

export function AutomationsLayout() {
  const { t } = useTranslation(['nav', 'pages']);
  const [actions, setActions] = useState<React.ReactNode>(null);
  const pending = usePendingViolationsCount(true);
  const outletContext = useMemo<AutomationsOutletContext>(() => ({ setActions }), []);
  const tabs = useSectionTabs([
    { nameKey: 'rules', href: '/automations', end: true },
    { nameKey: 'violations', href: '/violations', count: pending },
  ]);

  return (
    <SectionLayout
      titleKey="pages:automations.title"
      tabs={tabs}
      actions={actions}
      ariaLabel={t('pages:automations.title')}
      outletContext={outletContext}
    />
  );
}
