import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Counter, DefaultValue } from './PreviewField';
import type { FieldData } from './fieldData';

interface ToastPreviewProps {
  title: FieldData;
  message: FieldData;
}

export function ToastPreview({ title, message }: ToastPreviewProps) {
  const { t } = useTranslation('pages');
  const fields = [
    { label: t('automations.message.fieldTitle'), data: title },
    { label: t('automations.message.fieldMessage'), data: message },
  ];
  return (
    <div className="max-w-sm space-y-2">
      <div className="bg-card flex gap-2 rounded-lg border p-3 text-sm shadow-xs">
        <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 space-y-0.5 break-words whitespace-pre-line">
          <p className="font-medium">{title.text ?? <DefaultValue hint={false} />}</p>
          <p>{message.text ?? <DefaultValue hint={false} />}</p>
        </div>
      </div>
      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {fields.map(({ label, data }) => (
          <div key={label} className="flex gap-1.5">
            <dt className="font-medium">{label}</dt>
            <dd>
              <Counter data={data} />
            </dd>
          </div>
        ))}
      </dl>
      {(title.text === undefined || message.text === undefined) && (
        <p className="text-muted-foreground text-xs">
          {t('automations.message.previewDefaultHint')}
        </p>
      )}
    </div>
  );
}
