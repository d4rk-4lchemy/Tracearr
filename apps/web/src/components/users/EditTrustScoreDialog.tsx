import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TrustScoreBadge } from './TrustScoreBadge';
import { useUpdateUser } from '@/hooks/queries';

interface EditTrustScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  currentScore: number;
  username: string;
}

export function EditTrustScoreDialog({
  open,
  onOpenChange,
  userId,
  currentScore,
  username,
}: EditTrustScoreDialogProps) {
  const { t } = useTranslation(['pages', 'common']);
  const [score, setScore] = useState(currentScore);
  const mutation = useUpdateUser();

  const [synced, setSynced] = useState({ open, currentScore });
  if (synced.open !== open || synced.currentScore !== currentScore) {
    setSynced({ open, currentScore });
    if (open) setScore(currentScore);
  }

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clamped = Math.min(100, Math.max(0, Math.round(score)));
    mutation.mutate(
      { id: userId, data: { trustScore: clamped } },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setScore(currentScore);
    }
    onOpenChange(newOpen);
  };

  const previewScore = Math.min(100, Math.max(0, Math.round(score)));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('userDetail.adjustTrustScore')}</DialogTitle>
          <DialogDescription>
            {t('userDetail.adjustTrustScoreDesc', { username })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="trustScore">{t('common:labels.trustScore')}</Label>
            <div className="flex items-center gap-3">
              <Input
                id="trustScore"
                type="number"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-24"
              />
              <TrustScoreBadge score={previewScore} showLabel />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || previewScore === currentScore}>
              {mutation.isPending ? t('common:states.saving') : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
