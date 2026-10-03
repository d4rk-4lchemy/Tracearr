import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import {
  SEND_BODY_MAX,
  SEND_TITLE_MAX,
  type SendAction,
  type TemplateVariable,
} from '@tracearr/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { setSendText } from '@/lib/automations';
import { cn } from '@/lib/utils';
import { NotificationTextField } from '../NotificationTextField';
import { idOf, type BuilderDispatch } from './builderReducer';
import { NotificationPreview } from './NotificationPreview';

interface SendMessageSectionProps {
  action: SendAction;
  variables: readonly TemplateVariable[];
  dispatch: BuilderDispatch;
}

/** The send's own words, collapsed to a one-line summary until the reader opens it. */
export function SendMessageSection({ action, variables, dispatch }: SendMessageSectionProps) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(action.title !== undefined || action.body !== undefined);
  const titleId = useId();
  const bodyId = useId();
  const id = idOf(action);
  const summary = action.title?.split('\n')[0] ?? t('automations.message.defaultText');

  const set = (field: 'title' | 'body') => (value: string) =>
    dispatch({ type: 'setAction', id, action: setSendText(action, field, value) });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="col-span-full">
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium">
        <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
        {t('automations.message.heading')}
        {!open && <span className="text-muted-foreground truncate font-normal">{summary}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        <Field>
          <FieldLabel id={titleId}>{t('automations.message.title')}</FieldLabel>
          <NotificationTextField
            id={`${titleId}-input`}
            aria-labelledby={titleId}
            value={action.title ?? ''}
            onChange={set('title')}
            variables={variables}
            multiline={false}
            maxLength={SEND_TITLE_MAX}
          />
        </Field>
        <Field>
          <FieldLabel id={bodyId}>{t('automations.message.body')}</FieldLabel>
          <NotificationTextField
            id={`${bodyId}-input`}
            aria-labelledby={bodyId}
            value={action.body ?? ''}
            onChange={set('body')}
            variables={variables}
            multiline
            maxLength={SEND_BODY_MAX}
          />
          <FieldDescription>{t('automations.message.blankHint')}</FieldDescription>
        </Field>
        <NotificationPreview
          title={action.title}
          body={action.body}
          to={action.to}
          priority={action.priority}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
