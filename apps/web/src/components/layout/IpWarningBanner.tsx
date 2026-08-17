import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { LayoutBanner } from './LayoutBanner';

const IP_WARNING_STATE_KEY = 'tracearr_ip_warning_state';

/**
 * Banner that displays when all users have the same IP or all have local/private IPs.
 * Uses conditional dismissal - only shows when the IP situation changes.
 */
export function IpWarningBanner() {
  const { t } = useTranslation('settings');
  const [dismissedState, setDismissedState] = useState<string | null>(null);

  // Load dismissed state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(IP_WARNING_STATE_KEY);
      setDismissedState(stored);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Fetch IP warning status
  const { data, isLoading } = useQuery({
    queryKey: ['ip-warning'],
    queryFn: () => api.settings.getIpWarning(),
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
  });

  // Don't show if loading or no warning
  if (isLoading || !data?.showWarning) {
    return null;
  }

  // Don't show if user has already dismissed this state
  if (dismissedState === data.stateHash) {
    return null;
  }

  const handleAcknowledge = () => {
    try {
      localStorage.setItem(IP_WARNING_STATE_KEY, data.stateHash);
      setDismissedState(data.stateHash);
    } catch {
      // Ignore localStorage errors
    }
  };

  return (
    <LayoutBanner variant="warning">
      <div className="flex items-center justify-between gap-4">
        <span className="flex-1">{t('ipWarning.message')}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAcknowledge}
          className="h-7 shrink-0 border-yellow-300 text-yellow-700 hover:border-yellow-400 hover:bg-yellow-100 hover:text-yellow-800 dark:border-yellow-600 dark:text-yellow-400 dark:hover:border-yellow-500 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-300"
        >
          {t('ipWarning.acknowledge')}
        </Button>
      </div>
    </LayoutBanner>
  );
}
