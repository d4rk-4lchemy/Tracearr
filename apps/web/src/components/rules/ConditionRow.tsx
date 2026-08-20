import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type {
  Condition,
  ConditionField,
  DeviceType,
  Operator,
  RulesFilterOptions,
} from '@tracearr/shared';
import { fromMetricDistance, toMetricDistance, formatConditionFieldValue } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NumericInput } from '@/components/ui/numeric-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MultiSelectOption } from '@/components/ui/multi-select';
import {
  FIELD_DEFINITIONS,
  CATEGORY_LABELS,
  DEVICE_TYPE_OPTIONS,
  OPERATOR_LABELS,
  getFieldsByCategory,
  getDefaultOperatorForField,
  getDefaultValueForField,
  isArrayOperator,
  type FieldCategory,
  type FieldDefinition,
} from '@/lib/rules';
import { useSettings } from '@/hooks/queries';
import { RuleFieldControl, type RuleControlSpec, type RuleControlValue } from './fields';

interface CountryGroupLabels {
  recentlySeen: string;
  allCountries: string;
}

interface ConditionRowProps {
  condition: Condition;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  showRemove?: boolean;
  filterOptions?: RulesFilterOptions;
  allowedFields?: ReadonlySet<string>;
}

export function ConditionRow({
  condition,
  onChange,
  onRemove,
  showRemove = true,
  filterOptions,
  allowedFields,
}: ConditionRowProps) {
  const { t } = useTranslation('pages');
  const { data: settings } = useSettings();
  const fieldId = useId();

  const fieldDef = FIELD_DEFINITIONS[condition.field] as FieldDefinition | undefined;
  const fieldsByCategory = getFieldsByCategory();
  const unitSystem = settings?.unitSystem ?? 'metric';

  // A stored rule can carry a field this build no longer defines (library_id
  // was removed); rendering nothing beats taking the whole builder down.
  if (!fieldDef) return null;

  const handleFieldChange = (newField: ConditionField) => {
    const newFieldDef = FIELD_DEFINITIONS[newField];
    const params: {
      window_hours?: number;
      exclude_same_device?: boolean;
      exclude_same_ip?: boolean;
    } = {};
    if (newFieldDef.hasWindowHours) params.window_hours = 24;
    if (newFieldDef.hasExcludeSameDevice) params.exclude_same_device = true;
    // Same-household viewing is legitimate, so this stays off unless asked for.
    if (newFieldDef.hasExcludeSameIp) params.exclude_same_ip = false;

    onChange({
      field: newField,
      operator: getDefaultOperatorForField(newField),
      value: getDefaultValueForField(newField),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
  };

  const handleOperatorChange = (newOperator: Operator) => {
    const wasArray = isArrayOperator(condition.operator);
    const isNowArray = isArrayOperator(newOperator);

    let newValue = condition.value;
    if (wasArray && !isNowArray && Array.isArray(condition.value)) {
      newValue = condition.value[0] ?? getDefaultValueForField(condition.field);
    } else if (!wasArray && isNowArray && !Array.isArray(condition.value)) {
      newValue = condition.value ? [condition.value as string] : [];
    }

    onChange({ ...condition, operator: newOperator, value: newValue });
  };

  const updateParams = (params: Partial<NonNullable<Condition['params']>>) => {
    onChange({ ...condition, params: { ...condition.params, ...params } });
  };

  const handleCountDeviceTypesChange = (types: string[]) => {
    const { count_device_types: _dropped, ...rest } = condition.params ?? {};
    onChange({
      ...condition,
      params:
        types.length > 0 ? { ...rest, count_device_types: types as DeviceType[] } : { ...rest },
    });
  };

  const conversion = numberConversion(fieldDef, condition.value, unitSystem);
  const valueSpec = buildValueSpec(
    fieldDef,
    isArrayOperator(condition.operator),
    filterOptions,
    conversion.unit,
    {
      recentlySeen: t('rules.builder.conditions.recentlySeen'),
      allCountries: t('rules.builder.conditions.allCountries'),
    }
  );

  return (
    <div className="flex flex-wrap items-start gap-2">
      <Select value={condition.field} onValueChange={handleFieldChange}>
        <SelectTrigger
          className="w-full @sm:w-52"
          aria-label={t('rules.builder.conditions.fieldPlaceholder')}
        >
          <SelectValue placeholder={t('rules.builder.conditions.fieldPlaceholder')} />
        </SelectTrigger>
        <SelectContent className="min-w-60">
          {(Object.keys(fieldsByCategory) as FieldCategory[]).map((category) => {
            // The row's own field always stays listed so the trigger keeps its
            // label even when the rest of the rule disallows it.
            const fields = fieldsByCategory[category].filter(
              (def) =>
                !allowedFields || allowedFields.has(def.field) || def.field === condition.field
            );
            if (fields.length === 0) return null;
            return (
              <SelectGroup key={category}>
                <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                {fields.map((def) => (
                  <SelectItem key={def.field} value={def.field}>
                    {def.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>

      <Select value={condition.operator} onValueChange={handleOperatorChange}>
        <SelectTrigger
          className="w-full @sm:w-40"
          aria-label={t('rules.builder.conditions.operatorPlaceholder')}
        >
          <SelectValue placeholder={t('rules.builder.conditions.operatorPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {fieldDef.operators.map((op) => (
            <SelectItem key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-36 flex-1">
        <RuleFieldControl
          id={`${fieldId}-value`}
          spec={valueSpec}
          value={conversion.displayValue}
          onChange={(next) => onChange({ ...condition, value: conversion.toStored(next) })}
        />
      </div>

      {fieldDef.hasWindowHours && (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm whitespace-nowrap">
            {t('rules.builder.conditions.windowPrefix')}
          </span>
          <NumericInput
            className="w-16"
            aria-label={t('rules.builder.conditions.windowUnit')}
            min={1}
            max={168}
            value={condition.params?.window_hours ?? 24}
            onChange={(window_hours) => updateParams({ window_hours })}
          />
          <span className="text-muted-foreground text-sm">
            {t('rules.builder.conditions.windowUnit')}
          </span>
        </div>
      )}

      {fieldDef.hasExcludeSameDevice && (
        <ConditionToggle
          label={t('rules.builder.conditions.uniqueDevices')}
          hint={t('rules.builder.conditions.uniqueDevicesHint')}
          checked={condition.params?.exclude_same_device ?? true}
          onChange={(exclude_same_device) => updateParams({ exclude_same_device })}
        />
      )}

      {fieldDef.hasExcludeSameIp && (
        <ConditionToggle
          label={t('rules.builder.conditions.uniqueIps')}
          hint={t('rules.builder.conditions.uniqueIpsHint')}
          checked={condition.params?.exclude_same_ip ?? false}
          onChange={(exclude_same_ip) => updateParams({ exclude_same_ip })}
        />
      )}

      {fieldDef.hasCountDeviceTypes && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-44 shrink-0">
              <RuleFieldControl
                id={`${fieldId}-device-types`}
                spec={{
                  kind: 'multiSelect',
                  options: DEVICE_TYPE_OPTIONS,
                  placeholder: t('rules.builder.conditions.allDeviceTypes'),
                }}
                value={condition.params?.count_device_types ?? []}
                onChange={(types) => handleCountDeviceTypesChange(types as string[])}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-60">
            {t('rules.builder.conditions.deviceTypesHint')}
          </TooltipContent>
        </Tooltip>
      )}

      {showRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('rules.builder.conditions.removeCondition')}
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

interface ConditionToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ConditionToggle({ label, hint, checked, onChange }: ConditionToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap">
          <Checkbox checked={checked} onCheckedChange={onChange} />
          <span className="text-muted-foreground text-sm">{label}</span>
        </label>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function dynamicOptions(
  field: ConditionField,
  filterOptions: RulesFilterOptions | undefined,
  groupLabels: CountryGroupLabels
): MultiSelectOption[] | undefined {
  if (!filterOptions) return undefined;

  switch (field) {
    case 'country':
      return filterOptions.countries?.map((country) => ({
        value: country.code,
        label: country.name,
        group: country.hasSessions ? groupLabels.recentlySeen : groupLabels.allCountries,
      }));
    case 'server_id':
      return filterOptions.servers?.map((server) => ({ value: server.id, label: server.name }));
    case 'user_id':
      return filterOptions.users?.map((user) => ({
        value: user.id,
        label: user.identityName || user.username,
      }));
    default:
      return undefined;
  }
}

function buildValueSpec(
  fieldDef: FieldDefinition,
  isArray: boolean,
  filterOptions: RulesFilterOptions | undefined,
  displayUnit: string | undefined,
  groupLabels: CountryGroupLabels
): RuleControlSpec {
  if (fieldDef.valueType === 'boolean') return { kind: 'boolean' };

  if (fieldDef.valueType === 'select' || fieldDef.valueType === 'multi-select') {
    const options =
      dynamicOptions(fieldDef.field, filterOptions, groupLabels) ?? fieldDef.options ?? [];
    return { kind: isArray ? 'multiSelect' : 'select', options, placeholder: fieldDef.placeholder };
  }

  if (fieldDef.valueType === 'number') {
    return {
      kind: 'number',
      min: fieldDef.min,
      max: fieldDef.max,
      step: fieldDef.step,
      unit: displayUnit ?? fieldDef.unit,
    };
  }

  return { kind: 'text', placeholder: fieldDef.placeholder };
}

interface NumberConversion {
  displayValue: RuleControlValue | undefined;
  toStored: (next: RuleControlValue) => Condition['value'];
  unit: string | undefined;
}

// Distances are stored metric; the picker shows whichever system the user set.
function numberConversion(
  fieldDef: FieldDefinition,
  value: Condition['value'],
  unitSystem: 'metric' | 'imperial'
): NumberConversion {
  const asIs: NumberConversion = {
    displayValue: value,
    toStored: (next) => next,
    unit: undefined,
  };

  if (fieldDef.valueType !== 'number' || typeof value !== 'number') return asIs;

  const converted = formatConditionFieldValue(value, fieldDef.field, unitSystem);
  if (!converted.unit) return asIs;

  return {
    displayValue: Math.round(fromMetricDistance(value, unitSystem)),
    toStored: (next) =>
      typeof next === 'number' ? Math.round(toMetricDistance(next, unitSystem)) : next,
    unit: converted.unit,
  };
}

export default ConditionRow;
