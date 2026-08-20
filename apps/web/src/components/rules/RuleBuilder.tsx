import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Loader2 } from 'lucide-react';
import type {
  ConditionGroup as ConditionGroupType,
  RuleConditions,
  RuleActions,
  Action,
  ViolationSeverity,
  CreateRuleV2Input,
  UpdateRuleV2Input,
  RulesFilterOptions,
} from '@tracearr/shared';
import { INACTIVITY_COMPATIBLE_FIELDS } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConditionGroup } from './ConditionGroup';
import { ActionRow } from './ActionRow';
import { RuleScopeField } from './RuleScopeField';
import {
  FIELD_DEFINITIONS,
  getDefaultOperatorForField,
  getDefaultValueForField,
  createDefaultAction,
  SEVERITY_OPTIONS,
  canEnforceAcrossServers as scopeAllowsCrossServer,
  isScopeComplete,
  scopeFromRule,
  scopeToPayload,
  type RuleScope,
} from '@/lib/rules';

export interface RuleBuilderInput {
  id: string;
  name: string;
  description?: string | null;
  severity?: ViolationSeverity;
  isActive: boolean;
  serverId?: string | null;
  serverUserId?: string | null;
  userId?: string | null;
  enforceAcrossServers?: boolean;
  conditions?: RuleConditions | null;
  actions?: RuleActions | null;
}

interface RuleBuilderProps {
  initialRule?: RuleBuilderInput;
  onSave: (data: CreateRuleV2Input | UpdateRuleV2Input) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  filterOptions?: RulesFilterOptions;
}

const DEFAULT_FIELD = 'concurrent_streams';

function createDefaultConditionGroup(): ConditionGroupType {
  return {
    conditions: [
      {
        field: DEFAULT_FIELD,
        operator: getDefaultOperatorForField(DEFAULT_FIELD),
        value: getDefaultValueForField(DEFAULT_FIELD),
      },
    ],
  };
}

function extractConditions(rule?: RuleBuilderInput): RuleConditions {
  if (rule?.conditions && 'groups' in rule.conditions) return rule.conditions;
  return { groups: [createDefaultConditionGroup()] };
}

function extractActions(rule?: RuleBuilderInput): RuleActions {
  if (rule?.actions && 'actions' in rule.actions) return rule.actions;
  return { actions: [createDefaultAction('log_only')] };
}

export function RuleBuilder({
  initialRule,
  onSave,
  onCancel,
  isLoading = false,
  filterOptions,
}: RuleBuilderProps) {
  const { t } = useTranslation(['pages', 'common']);

  const [name, setName] = useState(initialRule?.name ?? '');
  const [description, setDescription] = useState(initialRule?.description ?? '');
  const [severity, setSeverity] = useState<ViolationSeverity>(initialRule?.severity ?? 'warning');
  const [isActive, setIsActive] = useState(initialRule?.isActive ?? true);
  const [conditions, setConditions] = useState<RuleConditions>(() =>
    extractConditions(initialRule)
  );
  const [actions, setActions] = useState<RuleActions>(() => extractActions(initialRule));
  const [scope, setScope] = useState<RuleScope>(() => scopeFromRule(initialRule));
  const [enforceAcrossServers, setEnforceAcrossServers] = useState(
    initialRule?.enforceAcrossServers ?? false
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  // The backend rejects mixing inactive_days with session fields, so the field
  // picker offers only the still-valid choices for the rule as built.
  const allowedFields = useMemo<ReadonlySet<string> | undefined>(() => {
    const compatible = INACTIVITY_COMPATIBLE_FIELDS as readonly string[];
    const fields = conditions.groups.flatMap((g) => g.conditions.map((c) => c.field));
    if (fields.includes('inactive_days')) return new Set(compatible);
    if (fields.some((f) => !compatible.includes(f))) {
      return new Set(Object.keys(FIELD_DEFINITIONS).filter((f) => f !== 'inactive_days'));
    }
    return undefined;
  }, [conditions]);

  const canEnforce = useMemo(() => scopeAllowsCrossServer(scope, conditions), [scope, conditions]);

  const validate = (): boolean => {
    const found: string[] = [];

    if (!name.trim()) found.push(t('pages:rules.builder.errors.nameRequired'));
    if (!isScopeComplete(scope)) found.push(t('pages:rules.builder.errors.scopeIncomplete'));
    if (conditions.groups.length === 0) found.push(t('pages:rules.builder.errors.groupRequired'));
    if (conditions.groups.some((group) => group.conditions.length === 0)) {
      found.push(t('pages:rules.builder.errors.conditionRequired'));
    }
    if (actions.actions.some((a) => a.type === 'send' && a.to.length === 0)) {
      found.push(t('pages:rules.builder.errors.sendNeedsDestination'));
    }

    setErrors(found);
    return found.length === 0;
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    if (!validate()) return;

    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      severity,
      isActive,
      conditions,
      actions,
      ...scopeToPayload(scope),
      enforceAcrossServers: canEnforce ? enforceAcrossServers : false,
    });
  };

  const updateConditionGroup = (index: number, group: ConditionGroupType) => {
    const groups = [...conditions.groups];
    groups[index] = group;
    setConditions({ groups });
  };

  const removeConditionGroup = (index: number) => {
    if (conditions.groups.length === 1) return;
    setConditions({ groups: conditions.groups.filter((_, i) => i !== index) });
  };

  const updateAction = (index: number, action: Action) => {
    const next = [...actions.actions];
    next[index] = action;
    setActions({ actions: next });
  };

  return (
    // min-w-0: DialogContent is a grid, and a grid item can't shrink below its
    // min-content, so one too-wide row would otherwise widen the whole form.
    // @container: rows respond to the dialog, not the viewport.
    <div className="@container min-w-0 space-y-6">
      {errors.length > 0 && (
        <div className="border-destructive/50 bg-destructive/5 rounded-lg border p-4" role="alert">
          <p className="text-destructive font-medium">{t('pages:rules.builder.errors.title')}</p>
          <ul className="text-destructive mt-2 list-inside list-disc text-sm">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <FieldGroup className="gap-4">
        <div className="grid gap-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] @2xl:items-end">
          <Field>
            <FieldLabel htmlFor="rule-name">{t('pages:rules.ruleName')}</FieldLabel>
            <Input
              id="rule-name"
              placeholder={t('pages:rules.ruleNamePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={submitted && !name.trim()}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="rule-description">
              {t('pages:rules.builder.descriptionLabel')}
            </FieldLabel>
            <Input
              id="rule-description"
              placeholder={t('pages:rules.builder.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="rule-severity">
              {t('pages:rules.builder.severityLabel')}
            </FieldLabel>
            <Select value={severity} onValueChange={(v) => setSeverity(v as ViolationSeverity)}>
              <SelectTrigger id="rule-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field className="@2xl:w-auto">
            <FieldLabel htmlFor="rule-active">{t('pages:rules.builder.activeLabel')}</FieldLabel>
            <div className="flex h-9 items-center">
              <Switch id="rule-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </Field>
        </div>

        <RuleScopeField
          scope={scope}
          onChange={setScope}
          enforceAcrossServers={enforceAcrossServers}
          onEnforceAcrossServersChange={setEnforceAcrossServers}
          canEnforceAcrossServers={canEnforce}
          showErrors={submitted}
        />
      </FieldGroup>

      <section className="bg-muted/30 space-y-4 rounded-lg border p-4">
        <header className="border-b pb-3">
          <h3 className="text-base font-semibold">{t('pages:rules.builder.conditions.title')}</h3>
          <p className="text-muted-foreground text-sm">
            {t('pages:rules.builder.conditions.description')}
          </p>
        </header>

        <div className="space-y-4">
          {conditions.groups.map((group, index) => (
            <div key={index}>
              {index > 0 && (
                <div className="my-4 flex items-center gap-2">
                  <div className="bg-border h-px flex-1" />
                  <span className="text-muted-foreground bg-muted rounded-full px-3 py-1 text-sm font-bold">
                    AND
                  </span>
                  <div className="bg-border h-px flex-1" />
                </div>
              )}
              <ConditionGroup
                group={group}
                groupIndex={index}
                onChange={(g) => updateConditionGroup(index, g)}
                onRemove={() => removeConditionGroup(index)}
                showRemove={conditions.groups.length > 1}
                filterOptions={filterOptions}
                allowedFields={allowedFields}
              />
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setConditions({ groups: [...conditions.groups, createDefaultConditionGroup()] })
          }
        >
          <Plus />
          {t('pages:rules.builder.conditions.addGroup')}
        </Button>
      </section>

      <section className="bg-muted/30 space-y-4 rounded-lg border p-4">
        <header className="border-b pb-3">
          <h3 className="text-base font-semibold">{t('pages:rules.builder.actions.title')}</h3>
          <p className="text-muted-foreground text-sm">
            {t('pages:rules.builder.actions.description')}
          </p>
        </header>

        {actions.actions.length > 0 && (
          <div className="space-y-3">
            {actions.actions.map((action, index) => (
              <ActionRow
                key={index}
                action={action}
                onChange={(a) => updateAction(index, a)}
                onRemove={() =>
                  setActions({ actions: actions.actions.filter((_, i) => i !== index) })
                }
                showRemove
              />
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setActions({ actions: [...actions.actions, createDefaultAction('log_only')] })
          }
        >
          <Plus />
          {t('pages:rules.builder.actions.add')}
        </Button>
      </section>

      <div className="flex items-center justify-end gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" />
              {t('pages:rules.builder.saving')}
            </>
          ) : (
            <>
              <Save />
              {initialRule ? t('pages:rules.updateRule') : t('pages:rules.createRule')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default RuleBuilder;
