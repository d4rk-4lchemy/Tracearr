import { useTranslation } from 'react-i18next';
import { Separator } from '@/components/ui/separator';
import { PreviewAdded, PreviewField } from './PreviewField';
import type { FieldData } from './fieldData';

interface EmailPreviewProps {
  title: FieldData;
  message: FieldData;
}

export function EmailPreview({ title, message }: EmailPreviewProps) {
  const { t } = useTranslation('pages');
  const subject = { ...title, text: title.text?.replace(/[\r\n]+/g, ' ') };
  return (
    <div className="space-y-2">
      <dl className="space-y-2">
        <PreviewField label={t('automations.message.fieldSubject')} data={subject} emphasized />
      </dl>
      <Separator />
      <dl className="space-y-2">
        <PreviewField
          label={t('automations.message.fieldHeading')}
          data={title}
          emphasized
          counted={false}
          hint={false}
        />
        <PreviewField label={t('automations.message.fieldMessage')} data={message} />
      </dl>
      <PreviewAdded>{t('automations.message.addedEmail')}</PreviewAdded>
    </div>
  );
}
