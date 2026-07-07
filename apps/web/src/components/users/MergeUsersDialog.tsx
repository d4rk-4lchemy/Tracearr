import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface MergeCandidateServerAccount {
  id: string;
  serverName: string;
  removedAt: string | null;
}

export interface MergeCandidate {
  userId: string;
  displayName: string;
  username: string;
  loginCapable: boolean;
  serverUsers?: MergeCandidateServerAccount[];
}

export interface MergeUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: [MergeCandidate, MergeCandidate];
  requiredTargetUserId: string | null;
  /** Whether the two identities share an account on the same server, requiring a destructive confirmation. */
  sameServerWarning: boolean;
  /** Name of the server whose accounts will be fused, shown in the destructive confirmation. */
  sameServerName: string | null;
  onConfirm: (input: {
    sourceUserId: string;
    targetUserId: string;
    confirmSameServerCombine: boolean;
  }) => void;
  isLoading: boolean;
}

export function MergeUsersDialog({
  open,
  onOpenChange,
  candidates,
  requiredTargetUserId,
  sameServerWarning,
  sameServerName,
  onConfirm,
  isLoading,
}: MergeUsersDialogProps) {
  const { t } = useTranslation(['pages', 'common']);
  const [targetUserId, setTargetUserId] = useState(requiredTargetUserId ?? candidates[0].userId);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setTargetUserId(requiredTargetUserId ?? candidates[0].userId);
    setAcknowledged(false);
  }, [open, requiredTargetUserId, candidates]);

  const source = candidates.find((c) => c.userId !== targetUserId) ?? candidates[0];

  const submit = (confirmSameServerCombine: boolean) => {
    onConfirm({ sourceUserId: source.userId, targetUserId, confirmSameServerCombine });
  };

  const picker = (
    <fieldset
      className="space-y-2"
      role="radiogroup"
      aria-label={t('pages:users.mergePickPrimary')}
    >
      <legend className="text-sm font-medium">{t('pages:users.mergePickPrimary')}</legend>
      {candidates.map((candidate) => {
        const forced = requiredTargetUserId !== null;
        const disabled = forced && candidate.userId !== requiredTargetUserId;
        return (
          <label
            key={candidate.userId}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type="radio"
              name="merge-primary"
              value={candidate.userId}
              checked={targetUserId === candidate.userId}
              disabled={disabled}
              onChange={() => setTargetUserId(candidate.userId)}
              aria-label={candidate.displayName}
              className="mt-1"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">{candidate.displayName}</span>
              <span className="text-muted-foreground text-xs">@{candidate.username}</span>
              {candidate.serverUsers && candidate.serverUsers.length > 0 && (
                <span className="flex flex-wrap gap-1 pt-1">
                  {candidate.serverUsers.map((serverUser) => (
                    <Badge
                      key={serverUser.id}
                      variant="secondary"
                      className={cn(
                        'gap-1 font-normal',
                        serverUser.removedAt && 'text-muted-foreground'
                      )}
                    >
                      {serverUser.serverName}
                      {serverUser.removedAt && (
                        <span>{t('pages:users.mergeServerAccountRemoved')}</span>
                      )}
                    </Badge>
                  ))}
                </span>
              )}
            </span>
          </label>
        );
      })}
      {requiredTargetUserId !== null && (
        <p className="text-muted-foreground text-xs">{t('pages:users.mergePrimaryForced')}</p>
      )}
    </fieldset>
  );

  // The same-server combine is destructive and irreversible: render the whole
  // flow through AlertDialog so the confirmation matches the repo's
  // destructive-confirm pattern rather than a checkbox bolted onto a plain Dialog.
  if (sameServerWarning) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
              {t('pages:users.mergeSameServerWarningTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('pages:users.mergeDialogDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {picker}

          <div className="border-destructive/50 bg-destructive/10 space-y-3 rounded-md border p-3">
            <p className="text-destructive text-sm">{t('pages:users.mergeSameServerWarning')}</p>
            {sameServerName && <p className="text-sm font-semibold">{sameServerName}</p>}
            <div className="flex items-center gap-2">
              <Checkbox
                id="merge-same-server-ack"
                checked={acknowledged}
                onCheckedChange={(value) => setAcknowledged(value === true)}
              />
              <Label htmlFor="merge-same-server-ack" className="text-sm">
                {t('pages:users.mergeSameServerAcknowledge')}
              </Label>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!acknowledged || isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => submit(true)}
            >
              {t('pages:users.mergeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages:users.mergeDialogTitle')}</DialogTitle>
          <DialogDescription>{t('pages:users.mergeDialogDescription')}</DialogDescription>
        </DialogHeader>

        {picker}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => submit(false)} disabled={isLoading}>
            {t('pages:users.mergeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
