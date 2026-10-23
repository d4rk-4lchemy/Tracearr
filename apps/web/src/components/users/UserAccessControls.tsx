import { useTranslation } from 'react-i18next';
import { Eye, KeyRound, Loader2 } from 'lucide-react';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FieldError, FieldGroup } from '@/components/ui/field';
import { AutosaveSelectField } from '@/components/ui/autosave-field';
import { LOGIN_ACCESS, type ServerUserDetail } from '@tracearr/shared';
import { useSettings, useUpdateUserAccess } from '@/hooks/queries';
import { useViewAs } from '@/hooks/queries/useImpersonation';
import { useMutationSaveStatus } from '@/hooks/useMutationSaveStatus';
import { safeFormatDate } from '@/lib/dateFormat';

interface UserAccessControlsProps {
  /** The page's user: `id` is the server_users row PATCH /users/:id takes, `userId` the identity impersonation takes. */
  user: Pick<
    ServerUserDetail,
    'id' | 'userId' | 'role' | 'loginAccess' | 'loginCount' | 'lastLoginAt'
  >;
  name: string;
}

export function UserAccessControls({ user, name }: UserAccessControlsProps) {
  const { t } = useTranslation('pages');
  const accountId = user.id;
  const identityId = user.userId;
  const accessUpdate = useUpdateUserAccess();
  const roleUpdate = useUpdateUserAccess();
  const accessStatus = useMutationSaveStatus(accessUpdate);
  const roleStatus = useMutationSaveStatus(roleUpdate);
  const viewAs = useViewAs();
  const memberSwitch = useSettings().data?.loginMethods.member;

  // Neither can sign in, and viewing as them is refused, so there is nothing to set
  const inactive = user.role === 'disabled' || user.role === 'pending';
  const loginAccess = accessUpdate.isPending
    ? (accessUpdate.variables?.data.loginAccess ?? user.loginAccess)
    : user.loginAccess;
  const defaultNote =
    memberSwitch === undefined
      ? t('userDetail.access.signInDefaultUnknown')
      : t(
          memberSwitch ? 'userDetail.access.signInDefaultOn' : 'userDetail.access.signInDefaultOff'
        );
  const role = roleUpdate.isPending ? (roleUpdate.variables?.data.role ?? user.role) : user.role;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t('userDetail.access.title')}
        </CardTitle>
        {!inactive && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={viewAs.isPending}
              aria-label={t('userDetail.access.viewAsLabel', { name })}
              title={t('userDetail.access.viewAsHint')}
              onClick={() => viewAs.mutate(identityId)}
            >
              {viewAs.isPending ? <Loader2 className="animate-spin" /> : <Eye />}
              {t('userDetail.access.viewAs')}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {viewAs.error && <FieldError>{viewAs.error.message}</FieldError>}
        {inactive ? (
          <p className="text-muted-foreground text-sm">
            {t(
              user.role === 'disabled' ? 'userDetail.access.disabled' : 'userDetail.access.pending'
            )}
          </p>
        ) : (
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <AutosaveSelectField
              id="user-login-access"
              label={t('userDetail.access.signIn')}
              description={defaultNote}
              value={loginAccess}
              onChange={(next) => {
                const picked = LOGIN_ACCESS.find((access) => access === next);
                if (picked) accessUpdate.mutate({ id: accountId, data: { loginAccess: picked } });
              }}
              options={[
                { value: 'allow', label: t('userDetail.access.signInAllow') },
                { value: 'default', label: t('userDetail.access.signInDefault') },
                { value: 'block', label: t('userDetail.access.signInBlock') },
              ]}
              status={accessStatus}
              errorMessage={accessUpdate.error?.message}
              onReset={accessUpdate.reset}
            />
            <AutosaveSelectField
              id="user-role"
              label={t('userDetail.access.role')}
              description={t('userDetail.access.roleHint')}
              value={role}
              onChange={(next) => {
                if (next === 'admin' || next === 'member') {
                  roleUpdate.mutate({ id: accountId, data: { role: next } });
                }
              }}
              options={[
                { value: 'admin', label: t('userDetail.access.roleAdmin') },
                { value: 'member', label: t('userDetail.access.roleMember') },
              ]}
              status={roleStatus}
              errorMessage={roleUpdate.error?.message}
              onReset={roleUpdate.reset}
            />
          </FieldGroup>
        )}

        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt>{t('userDetail.access.signIns')}</dt>
            <dd className="text-foreground font-medium">{user.loginCount}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>{t('userDetail.access.lastSignIn')}</dt>
            <dd className="text-foreground font-medium">
              {safeFormatDate(
                user.lastLoginAt,
                {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                },
                t('userDetail.access.never')
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
