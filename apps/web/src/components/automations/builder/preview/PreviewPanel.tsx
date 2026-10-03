import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewField } from './PreviewField';
import type { FieldData } from './fieldData';

interface PreviewPanelProps {
  title: FieldData;
  message: FieldData;
  between?: ReactNode;
}

/** The title and message pair that ntfy, Gotify, Pushover, Apprise and the neutral panel share. */
export function PreviewPanel({ title, message, between }: PreviewPanelProps) {
  const { t } = useTranslation('pages');
  return (
    <dl className="space-y-2">
      <PreviewField label={t('automations.message.fieldTitle')} data={title} emphasized />
      {between && <div>{between}</div>}
      <PreviewField label={t('automations.message.fieldMessage')} data={message} />
    </dl>
  );
}
