import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldGroup } from '@/components/ui/field';
import { AutosaveSelectField, AutosaveSwitchField } from '@/components/ui/autosave-field';
import { SettingsSection } from '@/components/settings/shell/SettingsSection';
import { ImageCacheCard } from '@/components/settings/servers/ImageCacheCard';
import { useServers, useSettings } from '@/hooks/queries';
import { useAuth } from '@/hooks/useAuth';
import { useDebouncedSave } from '@/hooks/useDebouncedSave';

const AUTOMATIC_POSTER_SOURCE = 'auto';

/**
 * Which server's poster wins, whether posters are cached after library syncs, and what the
 * cache holds. A null server id keeps using the most recently added copy of a title.
 */
export function Posters() {
  const { t } = useTranslation(['settings']);
  const { user } = useAuth();
  const { data: servers = [] } = useServers();
  const { data: settings, isLoading: isLoadingSettings } = useSettings();
  const preferredPosterField = useDebouncedSave(
    'preferredPosterServerId',
    settings?.preferredPosterServerId
  );
  const precacheField = useDebouncedSave('imagePrecacheEnabled', settings?.imagePrecacheEnabled);

  const hasServers = servers.length > 0;

  return (
    <SettingsSection title={t('nav.sections.posters')} description={t('nav.descriptions.posters')}>
      {user?.role !== 'owner' ? (
        <Alert>
          <Info />
          <AlertDescription>{t('servers.posterSource.ownerOnly')}</AlertDescription>
        </Alert>
      ) : isLoadingSettings ? (
        <FieldGroup>
          <Skeleton className="h-9 w-full max-w-sm" />
          <Skeleton className="h-9 w-full max-w-sm" />
        </FieldGroup>
      ) : (
        <FieldGroup>
          <AutosaveSelectField
            id="preferredPosterServerId"
            label={t('servers.posterSource.label')}
            description={
              hasServers
                ? t('servers.posterSource.description')
                : t('servers.posterSource.emptyHint')
            }
            value={preferredPosterField.value || AUTOMATIC_POSTER_SOURCE}
            onChange={(v) => {
              preferredPosterField.setValue(v === AUTOMATIC_POSTER_SOURCE ? null : v);
            }}
            options={[
              { value: AUTOMATIC_POSTER_SOURCE, label: t('servers.posterSource.automatic') },
              ...servers.map((server) => ({ value: server.id, label: server.name })),
            ]}
            disabled={!hasServers}
            status={preferredPosterField.status}
            errorMessage={preferredPosterField.errorMessage}
            onRetry={preferredPosterField.retry}
            onReset={preferredPosterField.reset}
          />

          <AutosaveSwitchField
            id="imagePrecacheEnabled"
            label={t('servers.posterSource.precache')}
            description={t('servers.posterSource.precacheDescription')}
            checked={precacheField.value ?? true}
            onChange={(v) => {
              precacheField.setValue(v);
            }}
            status={precacheField.status}
            errorMessage={precacheField.errorMessage}
            onRetry={precacheField.retry}
            onReset={precacheField.reset}
          />
        </FieldGroup>
      )}

      <ImageCacheCard />
    </SettingsSection>
  );
}
