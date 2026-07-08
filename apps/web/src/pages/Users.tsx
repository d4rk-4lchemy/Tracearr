import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TrustScoreBadge } from '@/components/users/TrustScoreBadge';
import { getAvatarUrl } from '@/components/users/utils';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { BulkActionsToolbar, type BulkAction } from '@/components/ui/bulk-actions-toolbar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { MergeUsersDialog, type MergeCandidate } from '@/components/users/MergeUsersDialog';
import { MergeSuggestionsBanner } from '@/components/users/MergeSuggestionsBanner';
import {
  deriveMergeActionState,
  findOverlappingServerName,
} from '@/components/users/mergeSelection';
import { User as UserIcon, Crown, Clock, Search, RotateCcw, UserX, Merge } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';
import type { ServerUserWithIdentity, MergeSuggestion } from '@tracearr/shared';
import { MERGE_SAME_SERVER_CONFIRMATION_REQUIRED, canLogin } from '@tracearr/shared';
import { useUsers, useBulkResetTrust, useMergeUsers } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useAuth } from '@/hooks/useAuth';
import { useRowSelection } from '@/hooks/useRowSelection';

export function Users() {
  const { t } = useTranslation(['pages', 'common']);
  // Using common namespace for shared labels
  const navigate = useNavigate();
  const [searchFilter, setSearchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [resetTrustConfirmOpen, setResetTrustConfirmOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<[MergeCandidate, MergeCandidate] | null>(
    null
  );
  const [mergeRequiredTarget, setMergeRequiredTarget] = useState<string | null>(null);
  const [mergeSameServerWarning, setMergeSameServerWarning] = useState(false);
  const [mergeSameServerName, setMergeSameServerName] = useState<string | null>(null);
  const pageSize = 100;
  const { selectedServerId } = useServer();
  const { user: authUser } = useAuth();
  const isOwner = authUser?.role === 'owner';

  const { data, isLoading } = useUsers({ page, pageSize, serverId: selectedServerId ?? undefined });
  const bulkResetTrust = useBulkResetTrust();
  const mergeUsersMutation = useMergeUsers();

  const users = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Define columns with translations
  const userColumns: ColumnDef<ServerUserWithIdentity>[] = useMemo(
    () => [
      {
        accessorKey: 'username',
        header: t('common:labels.user'),
        cell: ({ row }) => {
          const user = row.original;
          const avatarUrl = getAvatarUrl(user.serverId, user.thumbUrl, 40);
          return (
            <div className="flex items-center gap-3">
              <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={user.username}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <UserIcon className="text-muted-foreground h-5 w-5" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'font-medium',
                      user.removedAt && 'text-muted-foreground line-through'
                    )}
                  >
                    {user.identityName ?? user.username}
                  </span>
                  {user.role === 'owner' && (
                    <span title={t('common:labels.serverOwner')}>
                      <Crown className="h-4 w-4 text-yellow-500" />
                    </span>
                  )}
                  {user.removedAt && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500"
                      title={`Removed ${formatDistanceToNow(new Date(user.removedAt), { addSuffix: true })}`}
                    >
                      <UserX className="h-3 w-3" />
                      Removed
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">@{user.username}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'trustScore',
        header: t('common:labels.trustScore'),
        cell: ({ row }) => <TrustScoreBadge score={row.original.trustScore} showLabel />,
      },
      {
        accessorKey: 'joinedAt',
        header: t('common:labels.joined'),
        cell: ({ row }) => (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4" />
            {row.original.joinedAt
              ? formatDistanceToNow(new Date(row.original.joinedAt), { addSuffix: true })
              : t('common:labels.unknown')}
          </div>
        ),
      },
      {
        accessorKey: 'lastActivityAt',
        header: t('common:labels.lastActivity'),
        cell: ({ row }) => (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4" />
            {row.original.lastActivityAt
              ? formatDistanceToNow(new Date(row.original.lastActivityAt), { addSuffix: true })
              : t('common:labels.never')}
          </div>
        ),
      },
    ],
    [t]
  );

  // Row selection
  const {
    selectedIds,
    selectAllMode,
    selectedCount,
    toggleRow,
    togglePage,
    selectAll,
    clearSelection,
    isPageSelected,
    isPageIndeterminate,
  } = useRowSelection({
    getRowId: (row: ServerUserWithIdentity) => row.id,
    totalCount: total,
  });

  const handleBulkResetTrust = () => {
    // For users, we only support selecting specific IDs (not selectAll with filters)
    // since users don't have the same filter complexity as violations
    bulkResetTrust.mutate(Array.from(selectedIds), {
      onSuccess: () => {
        clearSelection();
        setResetTrustConfirmOpen(false);
      },
    });
  };

  const toMergeCandidate = (row: ServerUserWithIdentity): MergeCandidate => ({
    userId: row.userId,
    displayName: `${row.identityName ?? row.username} (${row.serverName})`,
    username: row.username,
    loginCapable: canLogin(row.role),
    serverUsers: [],
  });

  // Merge requires exactly two specific rows, not the selectAll-matching-filters mode.
  const mergeSelectedRows = selectAllMode ? [] : users.filter((u) => selectedIds.has(u.id));
  const mergeSelectionState = deriveMergeActionState(
    mergeSelectedRows,
    selectAllMode,
    selectedIds.size
  );
  const mergeActionDisabled = mergeSelectionState.disabled;
  const mergeActionTitle = mergeSelectionState.reasonKey
    ? t(mergeSelectionState.reasonKey)
    : undefined;

  const handleMergeConfirm = (input: {
    sourceUserId: string;
    targetUserId: string;
    confirmSameServerCombine: boolean;
  }) => {
    mergeUsersMutation.mutate(input, {
      onSuccess: () => {
        clearSelection();
        setMergeDialogOpen(false);
      },
      onError: (error) => {
        // Sentinel from a same-server combine the client didn't predict - escalate
        // to the destructive confirmation instead of a toast.
        if (error.message === MERGE_SAME_SERVER_CONFIRMATION_REQUIRED) {
          setMergeSameServerWarning(true);
        }
      },
    });
  };

  const handleReviewSuggestion = (suggestion: MergeSuggestion) => {
    const [firstUser, secondUser] = suggestion.users;
    const toCandidate = (identity: MergeSuggestion['users'][number]): MergeCandidate => ({
      userId: identity.userId,
      displayName: identity.name ?? identity.username,
      username: identity.username,
      loginCapable: identity.loginCapable,
      serverUsers: identity.serverUsers.map((su) => ({
        id: su.id,
        serverName: su.serverName,
        removedAt: su.removedAt,
      })),
    });
    const overlappingServerName = suggestion.wouldCombineSameServer
      ? findOverlappingServerName(firstUser.serverUsers, secondUser.serverUsers)
      : null;

    setMergeCandidates([toCandidate(firstUser), toCandidate(secondUser)]);
    setMergeRequiredTarget(suggestion.requiredTargetUserId);
    setMergeSameServerWarning(suggestion.wouldCombineSameServer);
    setMergeSameServerName(overlappingServerName);
    setMergeDialogOpen(true);
  };

  const bulkActions: BulkAction[] = [
    {
      key: 'reset-trust',
      label: t('pages:users.resetTrustScore'),
      icon: <RotateCcw className="h-4 w-4" />,
      variant: 'default',
      onClick: () => setResetTrustConfirmOpen(true),
      isLoading: bulkResetTrust.isPending,
    },
    ...(isOwner
      ? [
          {
            key: 'merge',
            label: t('pages:users.mergeUsers'),
            icon: <Merge className="h-4 w-4" />,
            variant: 'default' as const,
            disabled: mergeActionDisabled,
            title: mergeActionTitle,
            onClick: () => {
              if (mergeSelectedRows.length !== 2) {
                toast.error(t('pages:users.mergeSelectTwo'));
                return;
              }
              const [first, second] = mergeSelectedRows as [
                ServerUserWithIdentity,
                ServerUserWithIdentity,
              ];
              if (first.userId === second.userId) {
                toast.error(t('pages:users.mergeSameIdentity'));
                return;
              }
              const a = toMergeCandidate(first);
              const b = toMergeCandidate(second);
              const sameServer = first.serverId === second.serverId;
              setMergeCandidates([a, b]);
              setMergeRequiredTarget(a.loginCapable ? a.userId : b.loginCapable ? b.userId : null);
              setMergeSameServerWarning(sameServer);
              setMergeSameServerName(sameServer ? first.serverName : null);
              setMergeDialogOpen(true);
            },
            isLoading: mergeUsersMutation.isPending,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('pages:users.title')}</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder={t('pages:users.searchPlaceholder')}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {t('common:count.user', { count: total })}
          </p>
        </div>
      </div>

      {isOwner && <MergeSuggestionsBanner onReview={handleReviewSuggestion} />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('pages:users.allUsers')}</CardTitle>
          {selectedCount > 0 && !selectAllMode && total > selectedCount && (
            <Button variant="link" size="sm" onClick={selectAll} className="text-sm">
              {t('pages:users.selectAllUsers', { count: total })}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <DataTable
              columns={userColumns}
              data={users}
              pageSize={pageSize}
              pageCount={totalPages}
              page={page}
              onPageChange={setPage}
              filterColumn="username"
              filterValue={searchFilter}
              onRowClick={(user) => {
                void navigate(`/users/${user.id}`);
              }}
              emptyMessage={t('pages:users.noUsersFound')}
              selectable
              getRowId={(row) => row.id}
              selectedIds={selectedIds}
              selectAllMode={selectAllMode}
              onRowSelect={toggleRow}
              onPageSelect={togglePage}
              isPageSelected={isPageSelected(users)}
              isPageIndeterminate={isPageIndeterminate(users)}
            />
          )}
        </CardContent>
      </Card>

      {/* Bulk Actions Toolbar */}
      <BulkActionsToolbar
        selectedCount={selectedCount}
        selectAllMode={selectAllMode}
        totalCount={total}
        actions={bulkActions}
        onClearSelection={clearSelection}
      />

      {/* Reset Trust Score Confirmation */}
      <ConfirmDialog
        open={resetTrustConfirmOpen}
        onOpenChange={setResetTrustConfirmOpen}
        title={t('pages:users.resetTrustScoreTitle', { count: selectedCount })}
        description={t('pages:users.resetTrustScoreConfirm', { count: selectedCount })}
        confirmLabel={t('pages:users.resetTrustScore')}
        onConfirm={handleBulkResetTrust}
        isLoading={bulkResetTrust.isPending}
      />

      {/* Merge Users Dialog */}
      {mergeCandidates &&
        (mergeSameServerWarning ? (
          <MergeUsersDialog
            open={mergeDialogOpen}
            onOpenChange={setMergeDialogOpen}
            candidates={mergeCandidates}
            requiredTargetUserId={mergeRequiredTarget}
            isLoading={mergeUsersMutation.isPending}
            sameServerWarning
            sameServerName={mergeSameServerName ?? ''}
            onConfirm={handleMergeConfirm}
          />
        ) : (
          <MergeUsersDialog
            open={mergeDialogOpen}
            onOpenChange={setMergeDialogOpen}
            candidates={mergeCandidates}
            requiredTargetUserId={mergeRequiredTarget}
            isLoading={mergeUsersMutation.isPending}
            sameServerWarning={false}
            onConfirm={handleMergeConfirm}
          />
        ))}
    </div>
  );
}
