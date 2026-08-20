import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RuleBuilder, type RuleBuilderInput } from './RuleBuilder';
import type { CreateRuleV2Input, UpdateRuleV2Input, RulesFilterOptions } from '@tracearr/shared';

interface RuleBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: RuleBuilderInput;
  onSave: (data: CreateRuleV2Input | UpdateRuleV2Input) => Promise<void>;
  isLoading?: boolean;
  filterOptions?: RulesFilterOptions;
}

export function RuleBuilderDialog({
  open,
  onOpenChange,
  rule,
  onSave,
  isLoading,
  filterOptions,
}: RuleBuilderDialogProps) {
  const { t } = useTranslation('pages');
  const isEditing = !!rule;

  const handleSave = async (data: CreateRuleV2Input | UpdateRuleV2Input) => {
    await onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* min() keeps the wide form from outgrowing a narrow window */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[min(56rem,calc(100%-2rem))]">
        <DialogHeader className="sm:text-center">
          <DialogTitle className="text-xl">
            {isEditing ? t('rules.editRule') : t('rules.createRule')}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t('rules.updateDescription') : t('rules.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <RuleBuilder
          initialRule={rule}
          onSave={handleSave}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
          filterOptions={filterOptions}
        />
      </DialogContent>
    </Dialog>
  );
}

export default RuleBuilderDialog;
