import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Item } from '@/components/ui/item';
import { cn } from '@/lib/utils';
import { overLimit, type FieldData } from './fieldData';

export function Counter({ data, className }: { data: FieldData; className?: string }) {
  const { t } = useTranslation('pages');
  if (!data.limit) return null;
  const over = overLimit(data);
  return (
    <span
      className={cn(
        'text-xs font-normal tabular-nums',
        over ? 'text-destructive' : 'text-muted-foreground',
        className
      )}
    >
      {t(
        data.limit.unit === 'bytes'
          ? 'automations.message.previewCountBytes'
          : 'automations.message.previewCount',
        { used: data.used, max: data.limit.max }
      )}
      <output>{over && `, ${t('automations.message.previewCut')}`}</output>
    </span>
  );
}

export function DefaultValue({ hint = true }: { hint?: boolean }) {
  const { t } = useTranslation('pages');
  return (
    <>
      <span className="text-muted-foreground italic">
        {t('automations.message.previewDefault')}
      </span>
      {hint && (
        <span className="text-muted-foreground block text-xs">
          {t('automations.message.previewDefaultHint')}
        </span>
      )}
    </>
  );
}

interface PreviewFieldProps {
  label: string;
  data: FieldData;
  emphasized?: boolean;
  counted?: boolean;
  hint?: boolean;
}

/** One user-written field: its label and counter on one row, its value beneath. */
export function PreviewField({
  label,
  data,
  emphasized,
  counted = true,
  hint = true,
}: PreviewFieldProps) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground flex items-baseline justify-between gap-2 text-xs font-medium">
        <span>{label}</span>
        {counted && <Counter data={data} />}
      </dt>
      <dd className="max-h-64 min-w-0 overflow-y-auto text-sm break-words whitespace-pre-line">
        {data.text === undefined ? (
          <DefaultValue hint={hint} />
        ) : (
          <span className={cn(emphasized && 'font-medium')}>{data.text}</span>
        )}
      </dd>
    </div>
  );
}

/** A part Tracearr fills in, named rather than shown. */
export function PreviewAdded({ children }: { children: ReactNode }) {
  return (
    <Item variant="outline" size="sm" className="text-muted-foreground border-dashed text-xs">
      {children}
    </Item>
  );
}
