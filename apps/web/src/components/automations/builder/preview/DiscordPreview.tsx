import { useTranslation } from 'react-i18next';
import { PreviewAdded, PreviewField } from './PreviewField';
import type { FieldData } from './fieldData';

interface DiscordPreviewProps {
  title: FieldData;
  message: FieldData;
}

export function DiscordPreview({ title, message }: DiscordPreviewProps) {
  const { t } = useTranslation('pages');
  return (
    <div className="border-border space-y-2 border-l-2 pl-3">
      <dl className="space-y-2">
        <PreviewField label={t('automations.message.fieldEmbedTitle')} data={title} emphasized />
        <PreviewField label={t('automations.message.fieldDescription')} data={message} />
      </dl>
      <p className="text-muted-foreground text-xs">{t('automations.message.previewEscapeHint')}</p>
      <PreviewAdded>{t('automations.message.addedDiscord')}</PreviewAdded>
    </div>
  );
}
