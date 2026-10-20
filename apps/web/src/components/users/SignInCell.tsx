import { useTranslation } from 'react-i18next';
import { formatDistanceToNowStrict } from 'date-fns';
import type { LoginAccess, ServerUserWithIdentity } from '@tracearr/shared';
import { useSettings } from '@/hooks/queries';

const SETTING_LABEL_KEYS = {
  allow: 'pages:userDetail.access.signInAllow',
  default: 'pages:userDetail.access.signInDefault',
  block: 'pages:userDetail.access.signInBlock',
} as const satisfies Record<LoginAccess, string>;

/** Whether the person can sign in now; null when it rests on a switch this viewer cannot read. */
function effectiveSignIn(
  row: Pick<ServerUserWithIdentity, 'role' | 'loginAccess'>,
  memberSwitch: boolean | undefined
): boolean | null {
  if (row.role === 'owner') return true;
  if (row.role === 'disabled' || row.role === 'pending') return false;
  if (row.loginAccess === 'allow') return true;
  if (row.loginAccess === 'block') return false;
  return memberSwitch ?? null;
}

interface SignInCellProps {
  row: Pick<ServerUserWithIdentity, 'role' | 'loginAccess' | 'lastLoginAt'>;
  /** The viewer: only the owner can read the switch that Default follows. */
  isOwner: boolean;
}

/** The stored sign-in setting, then what it amounts to and the last sign-in. */
export function SignInCell({ row, isOwner }: SignInCellProps) {
  const { t } = useTranslation(['pages', 'common']);
  const memberSwitch = useSettings({ enabled: isOwner }).data?.loginMethods.member;
  const effective = effectiveSignIn(row, memberSwitch);

  return (
    <div className="text-sm">
      <div>{t(SETTING_LABEL_KEYS[row.loginAccess])}</div>
      {effective !== null && (
        <div className="text-muted-foreground text-xs">
          <span>{t(effective ? 'pages:users.signInOn' : 'pages:users.signInOff')}</span>
          {effective && (
            <span>
              {' · '}
              {row.lastLoginAt
                ? t('pages:users.signedInAgo', {
                    relative: formatDistanceToNowStrict(new Date(row.lastLoginAt), {
                      addSuffix: true,
                    }),
                  })
                : t('pages:users.neverSignedIn')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
