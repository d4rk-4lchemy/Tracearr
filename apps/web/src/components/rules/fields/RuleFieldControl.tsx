import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { NumericInput } from '@/components/ui/numeric-input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type RuleControlValue = string | number | boolean | string[] | number[];

export type RuleControlSpec =
  | { kind: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'boolean' }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'select'; options: MultiSelectOption[]; placeholder?: string }
  | { kind: 'multiSelect'; options: MultiSelectOption[]; placeholder?: string }
  | { kind: 'slider'; min: number; max: number; step: number };

interface RuleFieldControlProps {
  spec: RuleControlSpec;
  value: RuleControlValue | undefined;
  onChange: (value: RuleControlValue) => void;
  id?: string;
  className?: string;
  'aria-labelledby'?: string;
}

export function RuleFieldControl({
  spec,
  value,
  onChange,
  id,
  className,
  'aria-labelledby': ariaLabelledBy,
}: RuleFieldControlProps) {
  const { t } = useTranslation('pages');

  switch (spec.kind) {
    case 'boolean': {
      const checked = value === true;
      return (
        <div className={cn('flex h-9 items-center gap-2', className)}>
          <Switch id={id} checked={checked} onCheckedChange={onChange} />
          <span className="text-muted-foreground text-sm">
            {checked ? t('rules.builder.conditions.yes') : t('rules.builder.conditions.no')}
          </span>
        </div>
      );
    }

    case 'number':
      // Field forces direct children to w-full, so the cap belongs on the input.
      return (
        <div className={cn('flex items-center gap-2', className)}>
          <NumericInput
            id={id}
            className="max-w-24"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={typeof value === 'number' ? value : (spec.min ?? 0)}
            onChange={onChange}
          />
          {spec.unit && (
            <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
              {spec.unit}
            </span>
          )}
        </div>
      );

    case 'slider': {
      const current = typeof value === 'number' ? value : spec.min;
      return (
        <div className={cn('flex h-9 items-center gap-3', className)}>
          <Slider
            id={id}
            className="flex-1"
            aria-labelledby={ariaLabelledBy}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={[current]}
            onValueChange={([next]) => onChange(next ?? spec.min)}
          />
          <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums">
            {current}
          </span>
        </div>
      );
    }

    case 'select':
      return (
        <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
          <SelectTrigger id={id} aria-labelledby={ariaLabelledBy} className={className}>
            <SelectValue placeholder={spec.placeholder ?? t('rules.builder.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {spec.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'multiSelect':
      return (
        <MultiSelect
          id={id}
          aria-labelledby={ariaLabelledBy}
          className={className}
          options={spec.options}
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={onChange}
          placeholder={spec.placeholder ?? t('rules.builder.selectPlaceholder')}
          searchPlaceholder={t('rules.builder.searchPlaceholder')}
          emptyMessage={t('rules.builder.noMatches')}
          clearLabel={t('rules.builder.clearSelection')}
          countLabel={(count) => t('rules.builder.selectedCount', { count })}
        />
      );

    case 'text':
      return (
        <Input
          id={id}
          aria-labelledby={ariaLabelledBy}
          className={className}
          type="text"
          placeholder={spec.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
