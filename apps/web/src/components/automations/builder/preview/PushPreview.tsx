import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import { PreviewAdded } from './PreviewField';
import { PreviewPanel } from './PreviewPanel';
import type { FieldData } from './fieldData';

interface PushPreviewProps {
  title: FieldData;
  message: FieldData;
}

export function PushPreview({ title, message }: PushPreviewProps) {
  const { t } = useTranslation('pages');
  return (
    <div className="bg-card max-w-sm space-y-2 rounded-xl border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Smartphone className="size-4" />
        Tracearr
      </div>
      <PreviewPanel
        title={title}
        message={message}
        between={<PreviewAdded>{t('automations.message.addedPushSubtitle')}</PreviewAdded>}
      />
    </div>
  );
}
