import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type {
  Condition,
  ConditionGroup as ConditionGroupType,
  RulesFilterOptions,
} from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { ConditionRow } from './ConditionRow';
import { getDefaultOperatorForField, getDefaultValueForField } from '@/lib/rules';

interface ConditionGroupProps {
  group: ConditionGroupType;
  groupIndex: number;
  onChange: (group: ConditionGroupType) => void;
  onRemove: () => void;
  showRemove?: boolean;
  filterOptions?: RulesFilterOptions;
  allowedFields?: ReadonlySet<string>;
}

export function ConditionGroup({
  group,
  groupIndex,
  onChange,
  onRemove,
  showRemove = true,
  filterOptions,
  allowedFields,
}: ConditionGroupProps) {
  const { t } = useTranslation('pages');

  const addCondition = () => {
    const field = 'concurrent_streams';
    const newCondition: Condition = {
      field,
      operator: getDefaultOperatorForField(field),
      value: getDefaultValueForField(field),
    };
    onChange({ conditions: [...group.conditions, newCondition] });
  };

  const updateCondition = (index: number, condition: Condition) => {
    const conditions = [...group.conditions];
    conditions[index] = condition;
    onChange({ conditions });
  };

  const removeCondition = (index: number) => {
    if (group.conditions.length === 1) {
      onRemove();
      return;
    }
    onChange({ conditions: group.conditions.filter((_, i) => i !== index) });
  };

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-foreground text-sm font-medium">
          {t('rules.builder.conditions.groupLabel', { number: groupIndex + 1 })}
          <span className="ml-2 text-xs opacity-60">
            ({t('rules.builder.conditions.groupHint')})
          </span>
        </span>
        {showRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            {t('rules.builder.conditions.removeGroup')}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {group.conditions.map((condition, index) => (
          <div key={index}>
            {index > 0 && (
              <div className="my-2 flex items-center gap-2">
                <div className="bg-border h-px flex-1" />
                <span className="text-primary px-2 text-xs font-bold">OR</span>
                <div className="bg-border h-px flex-1" />
              </div>
            )}
            <ConditionRow
              condition={condition}
              onChange={(c) => updateCondition(index, c)}
              onRemove={() => removeCondition(index)}
              showRemove={group.conditions.length > 1}
              filterOptions={filterOptions}
              allowedFields={allowedFields}
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground mt-3"
        onClick={addCondition}
      >
        <Plus />
        {t('rules.builder.conditions.addCondition')}
      </Button>
    </div>
  );
}

export default ConditionGroup;
