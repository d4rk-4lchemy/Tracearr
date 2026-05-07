import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Server as ServerIcon,
  Trash2,
  RefreshCw,
  ExternalLink,
  XCircle,
  Loader2,
  AlertTriangle,
  Plus,
  Pencil,
  GripVertical,
  Link2,
  Check,
} from 'lucide-react';
import { MediaServerIcon } from '@/components/icons/MediaServerIcon';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { api, tokenStorage } from '@/lib/api';
import type { PlexDiscoveredServer } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { PlexServerSelector } from '@/components/auth/PlexServerSelector';
import { PlexAccountsManager } from '@/components/settings/PlexAccountsManager';
import { SERVER_COLOR_PALETTE, pickServerColor } from '@tracearr/shared';
import type { Server } from '@tracearr/shared';
import {
  useServers,
  useDeleteServer,
  useSyncServer,
  useUpdateServer,
  usePlexServerConnections,
  useReorderServers,
} from '@/hooks/queries';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function ServerSettings() {
  const { t } = useTranslation(['settings', 'common', 'notifications', 'pages']);
  const { data: serversData, isLoading, refetch } = useServers();
  const deleteServer = useDeleteServer();
  const syncServer = useSyncServer();
  const updateServer = useUpdateServer();
  const reorderServers = useReorderServers();
  const queryClient = useQueryClient();
  const { refetch: refetchUser, user } = useAuth();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editServer, setEditServer] = useState<Server | null>(null);
  const [serverType, setServerType] = useState<'plex' | 'jellyfin' | 'emby' | 'dispatcharr'>(
    'plex'
  );
  const [serverUrl, setServerUrl] = useState('');
  const [serverName, setServerName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dispatcharrAuthMode, setDispatcharrAuthMode] = useState<'token' | 'credentials'>(
    'credentials'
  );
  const [dispatcharrUsername, setDispatcharrUsername] = useState('');
  const [dispatcharrPassword, setDispatcharrPassword] = useState('');
  const [ignoreAnonymousStreams, setIgnoreAnonymousStreams] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Plex server discovery state
  const [plexDialogStep, setPlexDialogStep] = useState<
    'loading' | 'no-accounts' | 'select-account' | 'loading-servers' | 'no-servers' | 'select'
  >('loading');
  const [plexServers, setPlexServers] = useState<PlexDiscoveredServer[]>([]);
  const [connectingPlexServer, setConnectingPlexServer] = useState<string | null>(null);

  // Plex account selection state
  const [plexAccounts, setPlexAccounts] = useState<
    { id: string; plexUsername: string | null; plexEmail: string | null }[]
  >([]);
  const [selectedPlexAccountId, setSelectedPlexAccountId] = useState<string | null>(null);

  // Update server type when user data loads (non-owners can't add Plex)
  useEffect(() => {
    if (user && user.role !== 'owner' && serverType === 'plex') {
      setServerType('jellyfin');
    }
  }, [user, serverType]);

  // Fetch Plex accounts when dialog opens with Plex selected
  useEffect(() => {
    if (showAddDialog && serverType === 'plex' && user?.role === 'owner') {
      void fetchPlexAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on dialog open, not serverType changes
  }, [showAddDialog]);

  // Handle both array and wrapped response formats
  const servers = Array.isArray(serversData)
    ? serversData
    : ((serversData as unknown as { data?: Server[] })?.data ?? []);

  const handleDelete = () => {
    if (deleteId) {
      deleteServer.mutate(deleteId, {
        onSuccess: () => {
          setDeleteId(null);
          void queryClient.invalidateQueries({ queryKey: ['plex-accounts'] });
        },
      });
    }
  };

  const handleSync = (id: string) => {
    syncServer.mutate(id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = servers.findIndex((s) => s.id === active.id);
    const newIndex = servers.findIndex((s) => s.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Reorder locally for immediate feedback (optimistic update)
    const reorderedServers = arrayMove(servers, oldIndex, newIndex);

    // Send new order to backend
    const updates = reorderedServers.map((server, index) => ({
      id: server.id,
      displayOrder: index,
    }));

    reorderServers.mutate(updates);
  };

  // Default server type based on user role
  const defaultServerType = user?.role === 'owner' ? 'plex' : 'jellyfin';

  const resetAddForm = () => {
    setServerUrl('');
    setServerName('');
    setApiKey('');
    setDispatcharrAuthMode('credentials');
    setDispatcharrUsername('');
    setDispatcharrPassword('');
    setIgnoreAnonymousStreams(true);
    setConnectError(null);
    setServerType(defaultServerType as 'plex' | 'jellyfin' | 'emby' | 'dispatcharr');
    setPlexDialogStep('loading');
    setPlexServers([]);
    setConnectingPlexServer(null);
    setPlexAccounts([]);
    setSelectedPlexAccountId(null);
  };

  // Fetch linked Plex accounts
  const fetchPlexAccounts = async () => {
    setPlexDialogStep('loading');
    setConnectError(null);

    try {
      const result = await api.auth.getPlexAccounts();
      const accounts = result.accounts;

      if (accounts.length === 0) {
        setPlexDialogStep('no-accounts');
        return;
      }

      setPlexAccounts(accounts);

      // If only one account, auto-select and fetch servers
      const firstAccount = accounts[0];
      if (accounts.length === 1 && firstAccount) {
        setSelectedPlexAccountId(firstAccount.id);
        await fetchPlexServers(firstAccount.id);
      } else {
        // Multiple accounts - show account selector
        setPlexDialogStep('select-account');
      }
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Failed to fetch Plex accounts');
      setPlexDialogStep('no-accounts');
    }
  };

  // Fetch available Plex servers for a specific account
  const fetchPlexServers = async (accountId?: string) => {
    setPlexDialogStep('loading-servers');
    setConnectError(null);

    try {
      const result = await api.auth.getAvailablePlexServers(accountId);

      if (!result.hasPlexToken) {
        setPlexDialogStep('no-accounts');
        return;
      }

      if (result.servers.length === 0) {
        setPlexDialogStep('no-servers');
        return;
      }

      setPlexServers(result.servers);
      setPlexDialogStep('select');
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Failed to fetch Plex servers');
      setPlexDialogStep('no-servers');
    }
  };

  // Handle Plex server selection from PlexServerSelector
  const handlePlexServerSelect = async (
    serverUri: string,
    name: string,
    clientIdentifier: string
  ) => {
    setConnectingPlexServer(name);
    setConnectError(null);

    try {
      await api.auth.addPlexServer({
        serverUri,
        serverName: name,
        clientIdentifier,
        accountId: selectedPlexAccountId ?? undefined,
      });

      toast.success(t('notifications:toast.success.serverAdded.title'), {
        description: t('notifications:toast.success.serverAdded.message', { name }),
      });

      // Refresh server list, user data, and plex accounts (for server count)
      await refetch();
      await refetchUser();
      void queryClient.invalidateQueries({ queryKey: ['plex-accounts'] });

      // Close dialog and reset
      setShowAddDialog(false);
      resetAddForm();
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Failed to connect Plex server');
    } finally {
      setConnectingPlexServer(null);
    }
  };

  const handleAddServer = async () => {
    const isDispatcharrTokenMode = serverType === 'dispatcharr' && dispatcharrAuthMode === 'token';
    const hasRequiredFields =
      Boolean(serverUrl.trim()) &&
      Boolean(serverName.trim()) &&
      (serverType === 'dispatcharr'
        ? isDispatcharrTokenMode
          ? Boolean(apiKey.trim())
          : Boolean(dispatcharrUsername.trim()) && Boolean(dispatcharrPassword)
        : Boolean(apiKey.trim()));

    if (!hasRequiredFields) {
      setConnectError(t('servers.allFieldsRequired'));
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      if (serverType === 'dispatcharr') {
        const payload =
          dispatcharrAuthMode === 'credentials'
            ? {
                name: serverName,
                type: serverType,
                url: serverUrl,
                username: dispatcharrUsername,
                password: dispatcharrPassword,
                ignoreAnonymousStreams,
              }
            : {
                name: serverName,
                type: serverType,
                url: serverUrl,
                token: apiKey,
                ignoreAnonymousStreams,
              };

        await api.servers.create({
          ...payload,
        });
        await refetchUser();
      } else {
        const connectFn =
          serverType === 'jellyfin'
            ? api.auth.connectJellyfinWithApiKey
            : api.auth.connectEmbyWithApiKey;
        const result = await connectFn({
          serverUrl,
          serverName,
          apiKey,
        });

        // Update tokens if provided
        if (result.accessToken && result.refreshToken) {
          tokenStorage.setTokens(result.accessToken, result.refreshToken);
          await refetchUser();
        }
      }

      // Refresh server list
      await refetch();

      // Close dialog and reset form
      setShowAddDialog(false);
      resetAddForm();
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Failed to connect server');
    } finally {
      setIsConnecting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ServerIcon className="h-5 w-5" />
              {t('servers.title')}
            </CardTitle>
            <CardDescription>{t('servers.description')}</CardDescription>
          </div>
          <Button
            onClick={() => {
              setShowAddDialog(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('servers.addServer')}
          </Button>
        </CardHeader>
        <CardContent>
          {!servers || servers.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
              <ServerIcon className="text-muted-foreground h-8 w-8" />
              <p className="text-muted-foreground">{t('servers.noServersConnected')}</p>
              <p className="text-muted-foreground text-xs">{t('servers.noServersConnectedHint')}</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={servers.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-4">
                  {servers.map((server) => (
                    <SortableServerCard
                      key={server.id}
                      server={server}
                      onSync={() => {
                        handleSync(server.id);
                      }}
                      onDelete={() => {
                        setDeleteId(server.id);
                      }}
                      onEdit={() => {
                        setEditServer(server);
                      }}
                      isSyncing={syncServer.isPending}
                      isDraggable={user?.role === 'owner'}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {/* Plex Accounts Management - Only for owners */}
      {user?.role === 'owner' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              {t('pages:settings.plex.linkedAccounts')}
            </CardTitle>
            <CardDescription>{t('pages:settings.plex.linkedAccountsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <PlexAccountsManager onAccountLinked={() => void fetchPlexServers()} />
          </CardContent>
        </Card>
      )}

      {/* Add Server Dialog */}
      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          if (!open) {
            resetAddForm();
          }
          setShowAddDialog(open);
        }}
      >
        <DialogContent className="w-fit max-w-[calc(100vw-2rem)] min-w-[28rem] sm:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>{t('servers.addServer')}</DialogTitle>
            <DialogDescription>
              {serverType === 'plex'
                ? t('servers.addServerDialogDescPlex')
                : serverType === 'dispatcharr'
                  ? 'Connect a Dispatcharr server.'
                  : t('servers.addServerDialogDescOther')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Server Type Selector */}
            <div className="space-y-2">
              <Label>{t('servers.serverType')}</Label>
              <Select
                value={serverType}
                onValueChange={(v) => {
                  const newType = v as 'plex' | 'jellyfin' | 'emby' | 'dispatcharr';
                  setServerType(newType);
                  setConnectError(null);
                  if (newType !== 'dispatcharr') {
                    setDispatcharrAuthMode('credentials');
                    setDispatcharrUsername('');
                    setDispatcharrPassword('');
                    setIgnoreAnonymousStreams(true);
                  }
                  // Fetch Plex accounts when switching to Plex type
                  if (newType === 'plex' && user?.role === 'owner') {
                    void fetchPlexAccounts();
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {user?.role === 'owner' && <SelectItem value="plex">Plex</SelectItem>}
                  <SelectItem value="jellyfin">Jellyfin</SelectItem>
                  <SelectItem value="emby">Emby</SelectItem>
                  <SelectItem value="dispatcharr">Dispatcharr</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Plex Server Selection Flow */}
            {serverType === 'plex' ? (
              <>
                {plexDialogStep === 'loading' && (
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                    <p className="text-muted-foreground text-sm">{t('servers.loadingAccounts')}</p>
                  </div>
                )}

                {plexDialogStep === 'no-accounts' && (
                  <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                    <div>
                      <p className="font-medium">{t('servers.noPlexAccountsLinked')}</p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t('servers.noPlexAccountsLinkedHint')}
                      </p>
                    </div>
                    {connectError && <p className="text-destructive text-sm">{connectError}</p>}
                  </div>
                )}

                {plexDialogStep === 'select-account' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>{t('servers.selectPlexAccount')}</Label>
                      <Select
                        value={selectedPlexAccountId ?? ''}
                        onValueChange={(id) => {
                          setSelectedPlexAccountId(id);
                          void fetchPlexServers(id);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('servers.chooseAccount')} />
                        </SelectTrigger>
                        <SelectContent>
                          {plexAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.plexUsername ??
                                account.plexEmail ??
                                t('servers.plexAccount')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-muted-foreground text-xs">
                        {t('servers.selectAccountHelp')}
                      </p>
                    </div>
                  </div>
                )}

                {plexDialogStep === 'loading-servers' && (
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                    <p className="text-muted-foreground text-sm">
                      {t('servers.discoveringServers')}
                    </p>
                  </div>
                )}

                {plexDialogStep === 'no-servers' && (
                  <div className="space-y-4">
                    {plexAccounts.length > 1 && (
                      <div className="space-y-2">
                        <Label>{t('servers.plexAccount')}</Label>
                        <Select
                          value={selectedPlexAccountId ?? ''}
                          onValueChange={(id) => {
                            setSelectedPlexAccountId(id);
                            void fetchPlexServers(id);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {plexAccounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.plexUsername ??
                                  account.plexEmail ??
                                  t('servers.plexAccount')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                      <ServerIcon className="text-muted-foreground h-8 w-8" />
                      <div>
                        <p className="font-medium">{t('servers.allServersConnected')}</p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {t('servers.allServersConnectedDesc')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {plexDialogStep === 'select' && (
                  <div className="space-y-4">
                    {plexAccounts.length > 1 && (
                      <div className="space-y-2">
                        <Label>{t('servers.plexAccount')}</Label>
                        <Select
                          value={selectedPlexAccountId ?? ''}
                          onValueChange={(id) => {
                            setSelectedPlexAccountId(id);
                            void fetchPlexServers(id);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {plexAccounts.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.plexUsername ??
                                  account.plexEmail ??
                                  t('servers.plexAccount')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <PlexServerSelector
                      servers={plexServers}
                      onSelect={handlePlexServerSelect}
                      connecting={connectingPlexServer !== null}
                      connectingToServer={connectingPlexServer}
                      showCancel={false}
                      onTestCustomUrl={async (uri) => {
                        const result = await api.auth.testPlexConnection({
                          uri,
                          accountId: selectedPlexAccountId ?? undefined,
                        });
                        return result.connection;
                      }}
                    />
                  </div>
                )}

                {connectError && plexDialogStep === 'select' && (
                  <div className="text-destructive flex items-center gap-2 text-sm">
                    <XCircle className="h-4 w-4" />
                    {connectError}
                  </div>
                )}
              </>
            ) : (
              /* Jellyfin/Emby Form */
              <>
                <div className="space-y-2">
                  <Label htmlFor="serverUrl">{t('servers.serverUrl')}</Label>
                  <Input
                    id="serverUrl"
                    placeholder={t('servers.serverUrlPlaceholder')}
                    value={serverUrl}
                    onChange={(e) => {
                      setServerUrl(e.target.value);
                    }}
                  />
                  <p className="text-muted-foreground text-xs">
                    {serverType === 'jellyfin'
                      ? t('servers.serverUrlHelpJellyfin')
                      : serverType === 'emby'
                        ? t('servers.serverUrlHelpEmby')
                        : 'Dispatcharr base URL, for example http://dispatcharr.local:9191'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="serverName">{t('servers.serverName')}</Label>
                  <Input
                    id="serverName"
                    placeholder={t('servers.serverNamePlaceholder')}
                    value={serverName}
                    onChange={(e) => {
                      setServerName(e.target.value);
                    }}
                  />
                </div>
                {serverType === 'dispatcharr' && (
                  <div className="space-y-2">
                    <Label>Authentication</Label>
                    <Select
                      value={dispatcharrAuthMode}
                      onValueChange={(value) => {
                        const mode = value as 'token' | 'credentials';
                        setDispatcharrAuthMode(mode);
                        setConnectError(null);
                        if (mode === 'token') {
                          setDispatcharrUsername('');
                          setDispatcharrPassword('');
                        } else {
                          setApiKey('');
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="credentials">Username + Password (for WebSocket)</SelectItem>
                        <SelectItem value="token">API Key</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {serverType === 'dispatcharr' && dispatcharrAuthMode === 'credentials' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="dispatcharrUsername">Username</Label>
                      <Input
                        id="dispatcharrUsername"
                        placeholder="admin"
                        value={dispatcharrUsername}
                        onChange={(e) => {
                          setDispatcharrUsername(e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dispatcharrPassword">Password</Label>
                      <Input
                        id="dispatcharrPassword"
                        type="password"
                        placeholder="Enter your password"
                        value={dispatcharrPassword}
                        onChange={(e) => {
                          setDispatcharrPassword(e.target.value);
                        }}
                      />
                      <p className="text-muted-foreground text-xs">
                        Tracearr will authenticate against Dispatcharr and manage JWT tokens
                        automatically.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="apiKey">{t('common:labels.apiKey')}</Label>
                    <Input
                      id="apiKey"
                      type="password"
                      placeholder={t('servers.apiKeyPlaceholder')}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                      }}
                    />
                    <p className="text-muted-foreground text-xs">
                      {serverType === 'jellyfin'
                        ? t('servers.apiKeyHelpJellyfin')
                        : serverType === 'emby'
                          ? t('servers.apiKeyHelpEmby')
                          : 'Dispatcharr API key or JWT bearer token. API keys are sent as X-API-Key.'}
                    </p>
                  </div>
                )}
                {serverType === 'dispatcharr' && (
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id="dispatcharrIgnoreAnonymousStreams"
                      checked={ignoreAnonymousStreams}
                      onCheckedChange={(checked) => {
                        setIgnoreAnonymousStreams(checked === true);
                      }}
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor="dispatcharrIgnoreAnonymousStreams"
                        className="cursor-pointer font-medium"
                      >
                        Ignore Anonymouse streams
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        When enabled, Dispatcharr streams reported as anonymous are ignored.
                      </p>
                    </div>
                  </div>
                )}
                {connectError && (
                  <div className="text-destructive flex items-center gap-2 text-sm">
                    <XCircle className="h-4 w-4" />
                    {connectError}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddDialog(false);
                resetAddForm();
              }}
            >
              {t('common:actions.cancel')}
            </Button>
            {serverType !== 'plex' && (
              <Button onClick={handleAddServer} disabled={isConnecting}>
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('servers.connecting')}
                  </>
                ) : (
                  t('servers.connectServer')
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={() => {
          setDeleteId(null);
        }}
        title={t('servers.removeServer')}
        description={t('servers.removeServerConfirm')}
        confirmLabel={t('common:actions.remove')}
        onConfirm={handleDelete}
        isLoading={deleteServer.isPending}
      />

      {/* Edit Server Dialog */}
      <EditServerDialog
        server={editServer}
        servers={servers}
        onClose={() => {
          setEditServer(null);
        }}
        onUpdate={(name, url, clientIdentifier, color, ignoreAnonymousStreamsValue) => {
          if (editServer) {
            updateServer.mutate(
              {
                id: editServer.id,
                name,
                url,
                clientIdentifier,
                color,
                ignoreAnonymousStreams: ignoreAnonymousStreamsValue,
              },
              {
                onSuccess: () => {
                  setEditServer(null);
                },
              }
            );
          }
        }}
        isUpdating={updateServer.isPending}
      />
    </>
  );
}

/**
 * Edit Server Dialog
 * Name and/or URL. For Plex servers: shows PlexServerSelector for URL; for Jellyfin/Emby: simple URL input.
 */
function EditServerDialog({
  server,
  servers,
  onClose,
  onUpdate,
  isUpdating,
}: {
  server: Server | null;
  servers: Server[];
  onClose: () => void;
  onUpdate: (
    name?: string,
    url?: string,
    clientIdentifier?: string,
    color?: string | null,
    ignoreAnonymousStreams?: boolean
  ) => void;
  isUpdating: boolean;
}) {
  const { t } = useTranslation(['settings', 'common', 'pages']);
  const [editName, setEditName] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [editColor, setEditColor] = useState('#3b82f6');
  const [editIgnoreAnonymousStreams, setEditIgnoreAnonymousStreams] = useState(true);
  const isPlexServer = server?.type === 'plex';
  const isDispatcharrServer = server?.type === 'dispatcharr';

  // Fetch connections for Plex servers
  const { data: connectionsData, isLoading: isLoadingConnections } = usePlexServerConnections(
    isPlexServer ? server?.id : undefined
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (server) {
      setEditName(server.name);
      setManualUrl(server.url);
      setEditIgnoreAnonymousStreams(server.ignoreAnonymousStreams ?? true);
      const otherColors = servers.filter((s) => s.id !== server.id).map((s) => s.color);
      setEditColor(server.color ?? pickServerColor(server.type, otherColors));
    }
  }, [server, servers]);

  const handlePlexSelect = (uri: string, _name: string, clientIdentifier: string) => {
    const colorChanged = editColor !== (server?.color ?? '') ? editColor : undefined;
    const ignoreAnonymousStreamsChanged =
      isDispatcharrServer && editIgnoreAnonymousStreams !== (server?.ignoreAnonymousStreams ?? true)
        ? editIgnoreAnonymousStreams
        : undefined;

    onUpdate(
      editName !== server?.name ? editName : undefined,
      uri,
      clientIdentifier,
      colorChanged,
      ignoreAnonymousStreamsChanged
    );
  };

  const hasNameChange = server ? editName.trim() !== server.name : false;
  const hasUrlChange = server ? manualUrl.trim() !== server.url : false;
  const hasColorChange = server ? editColor !== (server.color ?? '') : false;
  const hasIgnoreAnonymousStreamsChange = server
    ? isDispatcharrServer && editIgnoreAnonymousStreams !== (server.ignoreAnonymousStreams ?? true)
    : false;
  const canSave =
    (hasNameChange || hasUrlChange || hasColorChange || hasIgnoreAnonymousStreamsChange) &&
    editName.trim().length > 0;

  const handleSave = () => {
    onUpdate(
      hasNameChange ? editName.trim() : undefined,
      hasUrlChange ? manualUrl.trim() : undefined,
      undefined,
      hasColorChange ? editColor : undefined,
      hasIgnoreAnonymousStreamsChange ? editIgnoreAnonymousStreams : undefined
    );
  };

  if (!server) return null;

  return (
    <Dialog open={!!server} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-fit max-w-[calc(100vw-2rem)] min-w-[28rem] sm:max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{t('servers.editServer')}</DialogTitle>
          <DialogDescription>{t('servers.editServerDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">{t('servers.serverName')}</Label>
            <Input
              id="edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t('servers.plexServerPlaceholder')}
              maxLength={100}
            />
          </div>

          {isPlexServer ? (
            // Plex: Show server selector for URL
            <div className="space-y-2">
              <Label>{t('servers.serverUrl')}</Label>
              {isLoadingConnections ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-muted-foreground ml-2 text-sm">
                    {t('servers.discoveringConnections')}
                  </span>
                </div>
              ) : connectionsData?.server ? (
                <>
                  <PlexServerSelector
                    servers={[connectionsData.server]}
                    onSelect={handlePlexSelect}
                    connecting={isUpdating}
                    connectingToServer={isUpdating ? server.name : null}
                    onCancel={onClose}
                    showCancel={true}
                    onTestCustomUrl={async (uri) => {
                      const result = await api.auth.testPlexConnection({ uri });
                      return result.connection;
                    }}
                  />
                  {hasNameChange && (
                    <p className="text-muted-foreground text-sm">{t('servers.updateHint')}</p>
                  )}
                </>
              ) : (
                <Input
                  id="edit-url"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder={t('servers.plexServerUrlPlaceholder')}
                />
              )}
            </div>
          ) : (
            // Jellyfin/Emby: URL input
            <div className="space-y-2">
              <Label htmlFor="edit-url">{t('servers.serverUrl')}</Label>
              <Input
                id="edit-url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="http://192.168.1.100:8096"
              />
            </div>
          )}

          {isDispatcharrServer && (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox
                id="edit-ignore-anonymous-streams"
                checked={editIgnoreAnonymousStreams}
                onCheckedChange={(checked) => {
                  setEditIgnoreAnonymousStreams(checked === true);
                }}
              />
              <div className="space-y-1">
                <Label
                  htmlFor="edit-ignore-anonymous-streams"
                  className="cursor-pointer font-medium"
                >
                  Ignore Anonymouse streams
                </Label>
                <p className="text-muted-foreground text-sm">
                  When enabled, Dispatcharr streams reported as anonymous are ignored.
                </p>
              </div>
            </div>
          )}

          {/* Color picker */}
          <div className="space-y-2">
            <Label>{t('servers.serverColor')}</Label>
            <div className="flex items-center gap-2">
              {SERVER_COLOR_PALETTE.map((preset) => {
                const isSelected = editColor.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => setEditColor(preset.hex)}
                    className={cn(
                      'relative h-8 w-8 rounded-full transition-transform',
                      'hover:scale-110',
                      isSelected && 'ring-offset-background scale-110 ring-2 ring-offset-2'
                    )}
                    style={{
                      backgroundColor: preset.hex,
                      ['--tw-ring-color' as string]: isSelected ? preset.hex : undefined,
                    }}
                    title={preset.label}
                  >
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Check className="h-4 w-4 text-white drop-shadow-md" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">{t('servers.serverColorDesc')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isUpdating || !canSave}>
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('servers.updating')}
              </>
            ) : (
              t('common:actions.update')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableServerCard({
  server,
  onSync,
  onDelete,
  onEdit,
  isSyncing,
  isDraggable,
}: {
  server: Server;
  onSync: () => void;
  onDelete: () => void;
  onEdit: () => void;
  isSyncing?: boolean;
  isDraggable?: boolean;
}) {
  const { t } = useTranslation(['settings', 'common', 'pages']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: server.id,
    disabled: !isDraggable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="touch-none">
      <div
        className={cn(
          'flex items-center justify-between rounded-lg border p-4',
          server.color && 'border-l-4',
          isDragging && 'ring-primary ring-2'
        )}
        style={server.color ? { borderLeftColor: server.color } : undefined}
      >
        <div className="flex items-center gap-4">
          {isDraggable && (
            <button
              className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-5 w-5" />
            </button>
          )}
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
            <MediaServerIcon type={server.type} className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{server.name}</h3>
              <button
                onClick={onEdit}
                className="hover:text-primary"
                title={t('servers.editServer')}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <span>{server.url}</span>
              <a
                href={server.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('servers.added', { date: format(new Date(server.createdAt), 'MMM d, yyyy') })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSync} disabled={isSyncing}>
            <RefreshCw className={cn('mr-1 h-4 w-4', isSyncing && 'animate-spin')} />
            {t('common:actions.sync')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="text-destructive h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
