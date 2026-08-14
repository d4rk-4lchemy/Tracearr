import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Link2, Unlink, Loader2, XCircle, Server, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { PlexAccount } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Plex OAuth configuration. The client identifier is NOT hardcoded: plex.tv
// scopes a PIN to the identifier that created it, and the server redeems the
// PIN this component creates, so both ends must send the same per-install
// value. It comes from GET /auth/plex/accounts.
const PLEX_OAUTH_URL = 'https://app.plex.tv/auth#';

interface PlexAccountsManagerProps {
  compact?: boolean; // For inline display in server settings
  onAccountLinked?: () => void; // Callback after linking account
}

export function PlexAccountsManager({
  compact = false,
  onAccountLinked,
}: PlexAccountsManagerProps) {
  const { t } = useTranslation(['notifications', 'pages', 'common']);
  const queryClient = useQueryClient();
  const [showManageDialog, setShowManageDialog] = useState(false);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Fetch plex accounts
  const {
    data: accountsData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['plex-accounts'],
    queryFn: () => api.auth.getPlexAccounts(),
  });

  const accounts = accountsData?.accounts ?? [];
  const plexClientId = accountsData?.clientIdentifier;

  // Unlink mutation
  const unlinkMutation = useMutation({
    mutationFn: (id: string) => api.auth.unlinkPlexAccount(id),
    onSuccess: () => {
      toast.success(t('toast.success.plexAccountUnlinked.title'), {
        description: t('toast.success.plexAccountUnlinked.message'),
      });
      void refetch();
      setShowUnlinkConfirm(null);
    },
    onError: (error: Error) => {
      toast.error(t('toast.error.plexUnlinkFailed'), {
        description: error.message,
      });
    },
  });

  // Start Plex OAuth flow for linking
  const startPlexOAuth = async () => {
    if (!plexClientId) {
      setLinkError('Plex client identifier unavailable - reload and try again');
      return;
    }

    setIsLinking(true);
    setLinkError(null);

    try {
      // Create Plex PIN
      const pinResponse = await fetch('https://plex.tv/api/v2/pins', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Plex-Client-Identifier': plexClientId,
          'X-Plex-Product': 'Tracearr',
        },
        body: JSON.stringify({
          strong: true,
          'X-Plex-Product': 'Tracearr',
          'X-Plex-Client-Identifier': plexClientId,
        }),
      });

      if (!pinResponse.ok) {
        throw new Error('Failed to create Plex PIN');
      }

      const pinData = (await pinResponse.json()) as { id: number; code: string };

      // Open Plex OAuth window
      const oauthUrl = `${PLEX_OAUTH_URL}?clientID=${plexClientId}&code=${pinData.code}&context%5Bdevice%5D%5Bproduct%5D=Tracearr`;
      const oauthWindow = window.open(oauthUrl, 'plex_oauth', 'width=600,height=700');

      // Poll for PIN authorization
      const pollInterval = setInterval(() => {
        void (async () => {
          try {
            const checkResponse = await fetch(`https://plex.tv/api/v2/pins/${pinData.id}`, {
              headers: {
                Accept: 'application/json',
                'X-Plex-Client-Identifier': plexClientId,
              },
            });

            if (!checkResponse.ok) {
              clearInterval(pollInterval);
              setIsLinking(false);
              setLinkError('Failed to check PIN status');
              return;
            }

            const checkData = (await checkResponse.json()) as { authToken: string | null };

            if (checkData.authToken) {
              clearInterval(pollInterval);
              oauthWindow?.close();

              // Now link the account via our API
              try {
                await api.auth.linkPlexAccount(pinData.id.toString());
                toast.success(t('toast.success.plexAccountLinked.title'), {
                  description: t('toast.success.plexAccountLinked.message'),
                });
                await refetch();
                await queryClient.invalidateQueries({ queryKey: ['plex-accounts'] });
                onAccountLinked?.();
                setIsLinking(false);
              } catch (error) {
                setLinkError(error instanceof Error ? error.message : 'Failed to link account');
                setIsLinking(false);
              }
            }
          } catch {
            // Continue polling
          }
        })();
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(
        () => {
          clearInterval(pollInterval);
          if (isLinking) {
            setIsLinking(false);
            setLinkError('OAuth timeout - please try again');
          }
        },
        5 * 60 * 1000
      );
    } catch (error) {
      setIsLinking(false);
      setLinkError(error instanceof Error ? error.message : 'Failed to start OAuth');
    }
  };

  // Compact view - just shows count and manage button
  if (compact) {
    if (isLoading) {
      return <Skeleton className="h-6 w-48" />;
    }

    return (
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">
          {accounts.length === 0
            ? t('pages:settings.plex.noAccountsLinkedShort')
            : t('pages:settings.plex.accountsLinked', { count: accounts.length })}
        </span>
        <Button variant="outline" size="sm" onClick={() => setShowManageDialog(true)}>
          {t('common:actions.edit')}
        </Button>
        <ManageDialog
          open={showManageDialog}
          onOpenChange={setShowManageDialog}
          accounts={accounts}
          isLoading={isLoading}
          isLinking={isLinking}
          linkError={linkError}
          onLink={startPlexOAuth}
          onUnlink={(id) => setShowUnlinkConfirm(id)}
        />
        <ConfirmDialog
          open={!!showUnlinkConfirm}
          onOpenChange={() => setShowUnlinkConfirm(null)}
          title={t('pages:settings.plex.unlinkPlexAccount')}
          description={t('pages:settings.plex.unlinkConfirm')}
          confirmLabel={t('common:actions.disconnect')}
          onConfirm={() => showUnlinkConfirm && unlinkMutation.mutate(showUnlinkConfirm)}
          isLoading={unlinkMutation.isPending}
        />
      </div>
    );
  }

  // Full view - shows all accounts inline
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <Link2 className="text-muted-foreground h-8 w-8" />
          <div>
            <p className="font-medium">{t('pages:settings.plex.noAccountsLinked')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('pages:settings.plex.noAccountsLinkedHint')}
            </p>
          </div>
          <Button onClick={startPlexOAuth} disabled={isLinking}>
            {isLinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('pages:settings.plex.linking')}
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                {t('pages:settings.plex.linkPlexAccount')}
              </>
            )}
          </Button>
          {linkError && (
            <p className="text-destructive flex items-center gap-1 text-sm">
              <XCircle className="h-4 w-4" />
              {linkError}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {accounts.map((account) => (
              <PlexAccountCard
                key={account.id}
                account={account}
                onUnlink={() => setShowUnlinkConfirm(account.id)}
              />
            ))}
          </div>
          <Button variant="outline" onClick={startPlexOAuth} disabled={isLinking}>
            {isLinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('pages:settings.plex.linking')}
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                {t('pages:settings.plex.linkAnotherAccount')}
              </>
            )}
          </Button>
          {linkError && (
            <p className="text-destructive flex items-center gap-1 text-sm">
              <XCircle className="h-4 w-4" />
              {linkError}
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!showUnlinkConfirm}
        onOpenChange={() => setShowUnlinkConfirm(null)}
        title={t('pages:settings.plex.unlinkPlexAccount')}
        description={t('pages:settings.plex.unlinkConfirm')}
        confirmLabel={t('common:actions.disconnect')}
        onConfirm={() => showUnlinkConfirm && unlinkMutation.mutate(showUnlinkConfirm)}
        isLoading={unlinkMutation.isPending}
      />
    </div>
  );
}

function PlexAccountCard({ account, onUnlink }: { account: PlexAccount; onUnlink: () => void }) {
  const { t } = useTranslation(['pages', 'common']);
  const canUnlink = account.serverCount === 0;

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={account.plexThumbnail ?? undefined} />
          <AvatarFallback>{account.plexUsername?.[0]?.toUpperCase() ?? 'P'}</AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {account.plexUsername ?? account.plexEmail ?? 'Plex Account'}
            </span>
            {account.allowLogin && (
              <Badge variant="secondary" className="text-xs">
                {t('pages:settings.plex.loginEnabled')}
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Server className="h-3 w-3" />
            <span>{t('pages:settings.plex.serversConnected', { count: account.serverCount })}</span>
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onUnlink}
        disabled={!canUnlink}
        title={
          canUnlink
            ? t('pages:settings.plex.unlinkAccount')
            : t('pages:settings.plex.deleteServersFirst')
        }
      >
        <Unlink className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ManageDialog({
  open,
  onOpenChange,
  accounts,
  isLoading,
  isLinking,
  linkError,
  onLink,
  onUnlink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: PlexAccount[];
  isLoading: boolean;
  isLinking: boolean;
  linkError: string | null;
  onLink: () => void;
  onUnlink: (id: string) => void;
}) {
  const { t } = useTranslation(['pages', 'common']);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages:settings.plex.linkedAccounts')}</DialogTitle>
          <DialogDescription>{t('pages:settings.plex.linkedAccountsDesc')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[400px] space-y-3 overflow-y-auto py-4">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
              <Link2 className="text-muted-foreground h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {t('pages:settings.plex.noAccountsYet')}
              </p>
            </div>
          ) : (
            accounts.map((account) => (
              <PlexAccountCard
                key={account.id}
                account={account}
                onUnlink={() => onUnlink(account.id)}
              />
            ))
          )}
        </div>
        {linkError && (
          <p className="text-destructive flex items-center gap-1 text-sm">
            <XCircle className="h-4 w-4" />
            {linkError}
          </p>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:actions.close')}
          </Button>
          <Button onClick={onLink} disabled={isLinking}>
            {isLinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('pages:settings.plex.linking')}
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                {t('pages:settings.plex.linkPlexAccount')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
