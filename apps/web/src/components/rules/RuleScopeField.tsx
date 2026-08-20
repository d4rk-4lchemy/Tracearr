import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ServerSelect } from '@/components/server';
import { useServer } from '@/hooks/useServer';
import { useUsers } from '@/hooks/queries/useUsers';
import {
  RULE_SCOPE_MODES,
  isScopeComplete,
  withScopeMode,
  type RuleScope,
  type RuleScopeMode,
} from '@/lib/rules/scope';

interface RuleScopeFieldProps {
  scope: RuleScope;
  onChange: (scope: RuleScope) => void;
  enforceAcrossServers: boolean;
  onEnforceAcrossServersChange: (value: boolean) => void;
  canEnforceAcrossServers: boolean;
  showErrors?: boolean;
}

export function RuleScopeField({
  scope,
  onChange,
  enforceAcrossServers,
  onEnforceAcrossServersChange,
  canEnforceAcrossServers,
  showErrors = false,
}: RuleScopeFieldProps) {
  const { t } = useTranslation('pages');
  const { servers } = useServer();
  const fieldId = useId();

  const scopeServerId = 'serverId' in scope ? scope.serverId : '';

  const { data: accountsPage } = useUsers(
    scope.mode === 'account' && scopeServerId ? { serverId: scopeServerId, pageSize: 100 } : {}
  );
  const { data: identitiesPage } = useUsers(scope.mode === 'person' ? { pageSize: 100 } : {});

  const accounts = accountsPage?.data ?? [];
  const identities = identitiesPage?.data ?? [];

  const handleModeChange = (mode: string) => {
    if (!mode) return;
    onChange(withScopeMode(scope, mode as RuleScopeMode, servers[0]?.id ?? ''));
  };

  const incomplete = showErrors && !isScopeComplete(scope);

  return (
    <FieldSet>
      <FieldLegend variant="label">{t('rules.builder.scope.label')}</FieldLegend>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={scope.mode}
        onValueChange={handleModeChange}
        className="flex-wrap"
      >
        {RULE_SCOPE_MODES.map((mode) => (
          <ToggleGroupItem
            key={mode}
            value={mode}
            className="data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
          >
            {t(`rules.builder.scope.${mode}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {scope.mode !== 'global' && (
        <FieldGroup>
          {servers.length === 0 && scope.mode !== 'person' ? (
            <FieldDescription>{t('rules.builder.scope.noServers')}</FieldDescription>
          ) : (
            <div className="grid gap-4 @md:grid-cols-2">
              {(scope.mode === 'server' || scope.mode === 'account') && (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-server`}>
                    {t('rules.builder.scope.serverLabel')}
                  </FieldLabel>
                  <ServerSelect
                    id={`${fieldId}-server`}
                    servers={servers}
                    value={scope.serverId}
                    placeholder={t('rules.builder.scope.serverPlaceholder')}
                    onChange={(serverId) =>
                      onChange(
                        scope.mode === 'account'
                          ? { mode: 'account', serverId, serverUserId: '' }
                          : { mode: 'server', serverId }
                      )
                    }
                  />
                </Field>
              )}

              {scope.mode === 'account' && scope.serverId && (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-account`}>
                    {t('rules.builder.scope.accountLabel')}
                  </FieldLabel>
                  <Select
                    value={scope.serverUserId}
                    onValueChange={(serverUserId) =>
                      onChange({ mode: 'account', serverId: scope.serverId, serverUserId })
                    }
                  >
                    <SelectTrigger id={`${fieldId}-account`}>
                      <SelectValue placeholder={t('rules.builder.scope.accountPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.identityName ?? account.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {scope.mode === 'person' && (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-person`}>
                    {t('rules.builder.scope.personLabel')}
                  </FieldLabel>
                  <Select
                    value={scope.userId}
                    onValueChange={(userId) => onChange({ mode: 'person', userId })}
                  >
                    <SelectTrigger id={`${fieldId}-person`}>
                      <SelectValue placeholder={t('rules.builder.scope.personPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {identities.map((identity) => (
                        <SelectItem key={identity.userId} value={identity.userId}>
                          {identity.identityName ?? identity.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
          )}

          {incomplete && <FieldError>{t('rules.builder.errors.scopeIncomplete')}</FieldError>}
        </FieldGroup>
      )}

      {canEnforceAcrossServers && (
        <Field orientation="horizontal">
          <Switch
            id={`${fieldId}-enforce`}
            checked={enforceAcrossServers}
            onCheckedChange={onEnforceAcrossServersChange}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${fieldId}-enforce`}>
              {t('rules.builder.scope.enforceAcrossServers')}
            </FieldLabel>
            <FieldDescription className="max-w-prose">
              {t('rules.builder.scope.enforceAcrossServersDescription')}
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    </FieldSet>
  );
}
