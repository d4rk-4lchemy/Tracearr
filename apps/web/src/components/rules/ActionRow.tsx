import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  AlertTriangle,
  FileText,
  Bell,
  TrendingUp,
  Target,
  RotateCcw,
  XCircle,
  MessageSquare,
  HelpCircle,
} from 'lucide-react';
import type { Action, ActionType } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ACTION_DEFINITIONS,
  getAllActionTypes,
  createDefaultAction,
  type ConfigField,
} from '@/lib/rules';
import { cn } from '@/lib/utils';
import { DestinationsField } from './DestinationsField';
import { RuleFieldControl, type RuleControlSpec, type RuleControlValue } from './fields';

const ACTION_ICONS: Record<ActionType, React.ComponentType<{ className?: string }>> = {
  log_only: FileText,
  send: Bell,
  adjust_trust: TrendingUp,
  set_trust: Target,
  reset_trust: RotateCcw,
  kill_stream: XCircle,
  message_client: MessageSquare,
};

interface ActionRowProps {
  action: Action;
  onChange: (action: Action) => void;
  onRemove: () => void;
  showRemove?: boolean;
}

export function ActionRow({ action, onChange, onRemove, showRemove = true }: ActionRowProps) {
  const { t } = useTranslation('pages');
  const typeId = useId();
  const def = ACTION_DEFINITIONS[action.type];

  const readValue = (name: string) => (action as unknown as Record<string, unknown>)[name];

  return (
    <div
      className={cn(
        'relative rounded-lg border p-4',
        showRemove && 'pr-14',
        def.color === 'destructive' && 'border-destructive/50 bg-destructive/5',
        def.color === 'warning' && 'border-warning/50 bg-warning/5',
        def.color === 'default' && 'border-border bg-card'
      )}
    >
      {showRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('rules.builder.actions.remove')}
          className="text-muted-foreground hover:text-destructive absolute top-3 right-3"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={typeId}>{t('rules.builder.actions.typeLabel')}</FieldLabel>
          <Select
            value={action.type}
            onValueChange={(type) => onChange(createDefaultAction(type as ActionType))}
          >
            <SelectTrigger id={typeId}>
              <SelectValue placeholder={t('rules.builder.actions.typePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {getAllActionTypes().map((type) => {
                const ActionIcon = ACTION_ICONS[type];
                return (
                  <SelectItem key={type} value={type}>
                    <span className="flex items-center gap-2">
                      <ActionIcon className="h-4 w-4" />
                      {ACTION_DEFINITIONS[type].label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <FieldDescription>{def.description}</FieldDescription>
        </Field>

        {def.configFields.map((field) => (
          <ActionConfigField
            key={field.name}
            field={field}
            value={readValue(field.name)}
            onChange={(value) => onChange({ ...action, [field.name]: value })}
          />
        ))}
      </div>

      {def.hint && (
        <p className="text-warning mt-3 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {def.hint}
        </p>
      )}
    </div>
  );
}

interface ActionConfigFieldProps {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ActionConfigField({ field, value, onChange }: ActionConfigFieldProps) {
  const controlId = useId();
  const labelId = useId();

  if (field.type === 'destinations') {
    return (
      <Field className="col-span-full">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        <DestinationsField
          value={(value as string[]) ?? []}
          onChange={onChange}
          label={field.label}
          labelledBy={labelId}
        />
        {field.description && <FieldDescription>{field.description}</FieldDescription>}
      </Field>
    );
  }

  const tooltips = field.options?.filter((option) => option.tooltip) ?? [];

  return (
    <Field className={cn(field.fullWidth && 'col-span-full')}>
      <FieldLabel htmlFor={controlId}>
        {field.label}
        {tooltips.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="text-muted-foreground/70 hover:text-muted-foreground h-3.5 w-3.5 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="w-max">
              <div className="space-y-1.5">
                {tooltips.map((option) => (
                  <div key={option.value}>
                    <span className="font-medium">{option.label}:</span>{' '}
                    <span className="text-muted-foreground">{option.tooltip}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </FieldLabel>
      <RuleFieldControl
        id={controlId}
        spec={toControlSpec(field)}
        value={value as RuleControlValue | undefined}
        onChange={onChange}
      />
      {field.description && <FieldDescription>{field.description}</FieldDescription>}
    </Field>
  );
}

function toControlSpec(field: ConfigField): RuleControlSpec {
  switch (field.type) {
    case 'number':
      return { kind: 'number', min: field.min, max: field.max, step: field.step, unit: field.unit };
    case 'select':
      return { kind: 'select', options: field.options ?? [], placeholder: field.placeholder };
    case 'slider':
      return { kind: 'slider', min: field.min ?? 0, max: field.max ?? 100, step: field.step ?? 1 };
    default:
      return { kind: 'text', placeholder: field.placeholder ?? field.label };
  }
}

export default ActionRow;
