import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldGroup } from '@/components/ui/field';
import { AutosaveSwitchField } from '@/components/ui/autosave-field';
import { Shield } from 'lucide-react';
import { useDebouncedSave } from '@/hooks/useDebouncedSave';
import { useSettings } from '@/hooks/queries';

export function AccessSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const { data: settings, isLoading } = useSettings();

  const allowGuestAccessField = useDebouncedSave('allowGuestAccess', settings?.allowGuestAccess);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t('accessControl.title')}
        </CardTitle>
        <CardDescription>{t('accessControl.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldGroup>
          <AutosaveSwitchField
            id="allowGuestAccess"
            label={t('accessControl.allowGuestAccess')}
            description={t('accessControl.allowGuestAccessDesc')}
            checked={false}
            onChange={() => undefined}
            disabled
            status={allowGuestAccessField.status}
            errorMessage={allowGuestAccessField.errorMessage}
            onRetry={allowGuestAccessField.retry}
            onReset={allowGuestAccessField.reset}
          />
        </FieldGroup>

        <div className="bg-muted/50 rounded-lg p-4">
          <p className="text-muted-foreground text-sm">
            <strong>Note:</strong> In v1, Tracearr only supports single-owner access. Even with
            guest access enabled, guests can only view their own sessions and violations.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
