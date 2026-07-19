import { useState } from 'react';
import {
  Monitor,
  MonitorPlay,
  Smartphone,
  Tablet,
  Tv,
  Play,
  Pause,
  Zap,
  Cpu,
  Server,
  X,
} from 'lucide-react';
import { getAvatarUrl } from '@/components/users/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn, formatLocationCompact } from '@/lib/utils';
import { imageProxyUrl } from '@/lib/api';
import { formatDuration } from '@/lib/formatters';
import { useEstimatedProgress } from '@/hooks/useEstimatedProgress';
import { useAuth } from '@/hooks/useAuth';
import { useServer } from '@/hooks/useServer';
import { ServerColorAccent } from '@/components/server';
import { TerminateSessionDialog } from './TerminateSessionDialog';
import { formatDispatcharrCatchupClock } from './useDispatcharrCatchupCardProgress';
import type { ActiveSession } from '@tracearr/shared';

interface NowPlayingCardProps {
  session: ActiveSession;
  onClick?: () => void;
}

function CatchupIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C10.2906 21 8.64935 20.5217 7.23062 19.6336C6.6528 19.2719 6.11762 18.8456 5.63567 18.3636C5.15297 17.8808 4.72614 17.3447 4.36416 16.7658C3.4775 15.3479 3 13.7079 3 12C3 11.726 3.01228 11.4533 3.03669 11.1826C3.08628 10.6325 3.57239 10.2268 4.12244 10.2764C4.6725 10.326 5.0782 10.8121 5.02861 11.3622C5.00958 11.5732 5 11.786 5 12C5 13.3302 5.37066 14.6032 6.05992 15.7055C6.34164 16.156 6.67401 16.5735 7.04996 16.9495C7.42534 17.3249 7.84208 17.6569 8.29179 17.9384C9.39466 18.6287 10.6687 19 12 19C15.866 19 19 15.866 19 12C19 8.13401 15.866 5 12 5C10.1286 5 8.38425 5.7394 7.09794 7.00204L8.49771 7.00341C9.04999 7.00341 9.49771 7.45113 9.49771 8.00341C9.49771 8.51625 9.11167 8.93892 8.61433 8.99669L8.49771 9.00341H4.49631C3.98347 9.00341 3.5608 8.61737 3.50304 8.12004L3.49631 8.00341V4.00351C3.49631 3.45123 3.94402 3.00351 4.49631 3.00351C5.00915 3.00351 5.43182 3.38955 5.48958 3.88689L5.49631 4.00351L5.49589 5.77846C7.1661 4.03158 9.49557 3 12 3ZM11.25 7C11.6295 7 11.9435 7.28233 11.9931 7.64827L12 7.75V12H14.25C14.664 12 15 12.336 15 12.75C15 13.1295 14.7177 13.4435 14.3517 13.4931L14.25 13.5H11.25C10.8705 13.5 10.5565 13.2177 10.5069 12.8517L10.5 12.75V7.75C10.5 7.336 10.836 7 11.25 7Z" />
    </svg>
  );
}

function getCardMediaDisplay(session: ActiveSession): { title: string; subtitle: string | null } {
  if (session.mediaType === 'live') {
    const channelTitle = session.channelTitle?.trim() || session.mediaTitle;
    const programTitle = session.mediaTitle?.trim() || null;
    const subtitle = programTitle && programTitle !== channelTitle ? programTitle : null;
    return { title: channelTitle, subtitle };
  }

  if (session.mediaType === 'episode' && session.grandparentTitle) {
    const episodeInfo =
      session.seasonNumber && session.episodeNumber
        ? `S${session.seasonNumber.toString().padStart(2, '0')} E${session.episodeNumber.toString().padStart(2, '0')}`
        : '';
    return {
      title: session.grandparentTitle,
      subtitle: episodeInfo ? `${episodeInfo} · ${session.mediaTitle}` : session.mediaTitle,
    };
  }

  if (session.mediaType === 'track') {
    const parts: string[] = [];
    if (session.artistName) parts.push(session.artistName);
    if (session.albumName) parts.push(session.albumName);
    return {
      title: session.mediaTitle,
      subtitle: parts.length > 0 ? parts.join(' · ') : null,
    };
  }

  return {
    title: session.mediaTitle,
    subtitle: session.year ? `${session.year}` : null,
  };
}

// Get device icon based on platform/device info
function DeviceIcon({ session, className }: { session: ActiveSession; className?: string }) {
  const platform = session.platform?.toLowerCase() ?? '';
  const device = session.device?.toLowerCase() ?? '';
  const product = session.product?.toLowerCase() ?? '';

  if (platform.includes('ios') || device.includes('iphone') || platform.includes('android')) {
    return <Smartphone className={className} />;
  }
  if (device.includes('ipad') || platform.includes('tablet')) {
    return <Tablet className={className} />;
  }
  if (
    platform.includes('tv') ||
    device.includes('tv') ||
    product.includes('tv') ||
    device.includes('roku') ||
    device.includes('firestick') ||
    device.includes('chromecast') ||
    device.includes('apple tv') ||
    device.includes('shield')
  ) {
    return <Tv className={className} />;
  }
  return <Monitor className={className} />;
}

export function NowPlayingCard({ session, onClick }: NowPlayingCardProps) {
  const { title, subtitle } = getCardMediaDisplay(session);
  const { user } = useAuth();
  const { isMultiServer } = useServer();
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);

  // Only admin/owner can terminate sessions, and session must support termination
  // (some Plex clients like Plexamp don't provide the required Session.id)
  const canTerminate = (user?.role === 'admin' || user?.role === 'owner') && session.canTerminate;

  // Use estimated progress for smooth updates between SSE/poll events
  const { estimatedProgressMs, progressPercent } = useEstimatedProgress(session);
  const isDispatcharrCatchup =
    session.server.type === 'dispatcharr' &&
    session.mediaType === 'live' &&
    session.dispatcharrPlaybackKind === 'catchup';

  // Time remaining based on estimated progress
  const remaining =
    session.totalDurationMs && estimatedProgressMs
      ? session.totalDurationMs - estimatedProgressMs
      : null;

  // Build poster URL using image proxy
  const posterUrl = session.thumbPath
    ? imageProxyUrl(session.serverId, session.thumbPath, 200, 300)
    : null;

  // User avatar URL (proxied for Jellyfin/Emby)
  const avatarUrl = getAvatarUrl(session.serverId, session.user.thumbUrl, 28) ?? undefined;

  const isPaused = session.state === 'paused';
  const isSquareArt = session.mediaType === 'track' || session.mediaType === 'live';
  const dispatcharrLiveSpeed =
    !isDispatcharrCatchup &&
    session.server.type === 'dispatcharr' &&
    session.mediaType === 'live' &&
    session.transcodeInfo?.speed !== undefined
      ? `${session.transcodeInfo.speed.toFixed(2)}x`
      : null;
  const catchupStartLabel = formatDispatcharrCatchupClock(
    session.dispatcharrCatchupEpgStartAt ?? null
  );
  const catchupEndLabel = formatDispatcharrCatchupClock(session.dispatcharrCatchupEpgEndAt ?? null);

  return (
    <>
      <ServerColorAccent
        serverId={session.serverId}
        onClick={onClick}
        className={cn(
          'group animate-fade-in bg-card card-hover relative overflow-hidden rounded-xl border',
          onClick && 'cursor-pointer'
        )}
      >
        {/* Background with poster blur */}
        {posterUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-20 blur-xl"
            style={{ backgroundImage: `url(${posterUrl})` }}
          />
        )}

        {/* Content */}
        <div className="relative flex gap-4 p-4">
          {/* Poster */}
          <div className="bg-muted relative h-28 w-20 flex-shrink-0 overflow-hidden rounded-lg shadow-lg">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={title}
                className={cn('h-full w-full', isSquareArt ? 'object-contain' : 'object-cover')}
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Server className="text-muted-foreground h-8 w-8" />
              </div>
            )}

            {/* Play/Pause indicator overlay */}
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity',
                isPaused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              {isPaused ? (
                <Pause className="h-8 w-8 text-white" />
              ) : (
                <Play className="h-8 w-8 text-white" />
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            {/* Top row: User and badges */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar className="border-background h-7 w-7 shrink-0 border-2 shadow">
                  <AvatarImage src={avatarUrl} alt={session.user.username} />
                  <AvatarFallback className="text-xs">
                    {session.user.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className="truncate text-sm font-medium"
                  title={session.user.identityName ?? session.user.username}
                >
                  {session.user.identityName ?? session.user.username}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {isDispatcharrCatchup && (
                  <div
                    className="focus:ring-ring inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent bg-blue-500/15 p-0 text-xs font-semibold text-blue-600 transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none dark:text-blue-400"
                    title="Catch-up"
                    data-testid="catchup-badge"
                  >
                    <CatchupIcon className="h-3.5 w-3.5" />
                  </div>
                )}

                {/* Quality badge - icon only with tooltip */}
                {(() => {
                  const isHwTranscode =
                    session.isTranscode &&
                    !!(session.transcodeInfo?.hwEncoding || session.transcodeInfo?.hwDecoding);

                  const label = session.isTranscode
                    ? isHwTranscode
                      ? 'HW Transcode'
                      : 'Transcode'
                    : session.videoDecision === 'copy' || session.audioDecision === 'copy'
                      ? 'Direct Stream'
                      : 'Direct Play';

                  const icon = session.isTranscode ? (
                    isHwTranscode ? (
                      <Cpu className="h-3.5 w-3.5" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )
                  ) : (
                    <MonitorPlay className="h-3.5 w-3.5" />
                  );

                  return (
                    <Badge
                      variant={session.isTranscode ? 'warning' : 'success'}
                      className="h-6 w-6 justify-center p-0"
                      title={label}
                      data-testid="quality-badge"
                    >
                      {icon}
                    </Badge>
                  );
                })()}

                {/* Device icon */}
                <div
                  className="bg-muted flex h-6 w-6 items-center justify-center rounded-md"
                  data-testid="device-badge"
                >
                  <DeviceIcon session={session} className="text-muted-foreground h-3.5 w-3.5" />
                </div>

                {/* Terminate button - admin/owner only */}
                {canTerminate && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTerminateDialog(true);
                    }}
                    title="Terminate stream"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Middle: Title */}
            <div className="mt-2">
              <h3 className="truncate text-sm leading-tight font-semibold">{title}</h3>
              {subtitle && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs">{subtitle}</p>
              )}
            </div>

            {/* Bottom: Progress */}
            <div className="mt-3 space-y-1">
              <Progress value={progressPercent} className="h-1.5" />
              <div className="text-muted-foreground flex justify-between text-[10px]">
                <span>
                  {isDispatcharrCatchup ? catchupStartLabel : formatDuration(estimatedProgressMs)}
                </span>
                <span>
                  {isDispatcharrCatchup ? (
                    catchupEndLabel
                  ) : isPaused ? (
                    <span className="font-medium text-yellow-500">Paused</span>
                  ) : dispatcharrLiveSpeed ? (
                    dispatcharrLiveSpeed
                  ) : remaining ? (
                    `-${formatDuration(remaining)}`
                  ) : (
                    formatDuration(session.totalDurationMs)
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Location/Quality footer */}
        <div className="bg-muted/50 text-muted-foreground relative flex items-center justify-between gap-2 border-t px-4 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            {isMultiServer && session.server && (
              <>
                <span className="shrink-0">{session.server.name}</span>
                <span className="text-muted-foreground/50">·</span>
              </>
            )}
            <span className="truncate">
              {formatLocationCompact(session.geoCity, session.geoRegion, session.geoCountry) ??
                'Unknown location'}
            </span>
          </span>
          <span className="flex-shrink-0">{session.quality ?? 'Unknown quality'}</span>
        </div>
      </ServerColorAccent>

      {/* Terminate confirmation dialog */}
      <TerminateSessionDialog
        open={showTerminateDialog}
        onOpenChange={setShowTerminateDialog}
        sessionId={session.id}
        mediaTitle={title}
        username={session.user.username}
      />
    </>
  );
}
