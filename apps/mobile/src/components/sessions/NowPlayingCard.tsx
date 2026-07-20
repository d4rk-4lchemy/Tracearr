/**
 * Compact card showing an active streaming session
 * Displays poster, title, user, progress bar, and play/pause status
 *
 * Responsive enhancements for tablets:
 * - Larger poster (80x120 vs 50x75)
 * - Quality badge (Direct Play/Direct Stream/Transcode)
 * - Device icon
 * - Location footer
 */
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/components/ui/text';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useImageUrl } from '@/hooks/useImageUrl';
import { useEstimatedProgress } from '@/hooks/useEstimatedProgress';
import { useResponsive } from '@/hooks/useResponsive';
import { ACCENT_COLOR, colors, spacing } from '@/lib/theme';
import { formatDuration } from '@/lib/formatters';
import { formatEpisodeLabel, type ActiveSession } from '@tracearr/shared';

interface NowPlayingCardProps {
  session: ActiveSession;
  onPress?: (session: ActiveSession) => void;
  isMultiServer?: boolean;
  serverColor?: string | null;
}

function CatchupIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Path
        d="M12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C10.2906 21 8.64935 20.5217 7.23062 19.6336C6.6528 19.2719 6.11762 18.8456 5.63567 18.3636C5.15297 17.8808 4.72614 17.3447 4.36416 16.7658C3.4775 15.3479 3 13.7079 3 12C3 11.726 3.01228 11.4533 3.03669 11.1826C3.08628 10.6325 3.57239 10.2268 4.12244 10.2764C4.6725 10.326 5.0782 10.8121 5.02861 11.3622C5.00958 11.5732 5 11.786 5 12C5 13.3302 5.37066 14.6032 6.05992 15.7055C6.34164 16.156 6.67401 16.5735 7.04996 16.9495C7.42534 17.3249 7.84208 17.6569 8.29179 17.9384C9.39466 18.6287 10.6687 19 12 19C15.866 19 19 15.866 19 12C19 8.13401 15.866 5 12 5C10.1286 5 8.38425 5.7394 7.09794 7.00204L8.49771 7.00341C9.04999 7.00341 9.49771 7.45113 9.49771 8.00341C9.49771 8.51625 9.11167 8.93892 8.61433 8.99669L8.49771 9.00341H4.49631C3.98347 9.00341 3.5608 8.61737 3.50304 8.12004L3.49631 8.00341V4.00351C3.49631 3.45123 3.94402 3.00351 4.49631 3.00351C5.00915 3.00351 5.43182 3.38955 5.48958 3.88689L5.49631 4.00351L5.49589 5.77846C7.1661 4.03158 9.49557 3 12 3ZM11.25 7C11.6295 7 11.9435 7.28233 11.9931 7.64827L12 7.75V12H14.25C14.664 12 15 12.336 15 12.75C15 13.1295 14.7177 13.4435 14.3517 13.4931L14.25 13.5H11.25C10.8705 13.5 10.5565 13.2177 10.5069 12.8517L10.5 12.75V7.75C10.5 7.336 10.836 7 11.25 7Z"
        fill={color}
      />
    </Svg>
  );
}

/**
 * Get display title for media (handles TV shows vs movies)
 */
function getMediaDisplay(session: ActiveSession): { title: string; subtitle: string | null } {
  if (session.mediaType === 'live') {
    const channelTitle = session.channelTitle?.trim() || session.mediaTitle;
    const programTitle = session.mediaTitle?.trim() || null;
    const subtitle = programTitle && programTitle !== channelTitle ? programTitle : null;
    return { title: channelTitle, subtitle };
  }

  if (session.mediaType === 'episode' && session.grandparentTitle) {
    // TV Show episode
    const episodeInfo =
      formatEpisodeLabel(session.seasonNumber, session.episodeNumber, { spaced: true }) ?? '';
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

  // Movie or other
  return {
    title: session.mediaTitle,
    subtitle: session.year ? `${session.year}` : null,
  };
}

/**
 * Get quality decision label, color, and icon
 */
function getQualityInfo(session: ActiveSession): {
  label: string;
  color: string;
  bgColor: string;
  icon: IoniconsIconName;
  isHwTranscode: boolean;
} {
  const videoDecision = session.videoDecision?.toLowerCase();
  const audioDecision = session.audioDecision?.toLowerCase();
  const isHwTranscode = !!(session.transcodeInfo?.hwEncoding || session.transcodeInfo?.hwDecoding);

  // If either is transcoding, show as transcode
  if (videoDecision === 'transcode' || audioDecision === 'transcode') {
    return {
      label: 'Transcode',
      color: colors.warning,
      bgColor: 'rgba(245, 158, 11, 0.15)',
      icon: isHwTranscode ? 'hardware-chip-outline' : 'flash',
      isHwTranscode,
    };
  }
  // If video is direct play and audio is direct play or copy
  if (
    videoDecision === 'directplay' &&
    (audioDecision === 'directplay' || audioDecision === 'copy')
  ) {
    return {
      label: 'Direct Play',
      color: colors.success,
      bgColor: 'rgba(34, 197, 94, 0.15)',
      icon: 'play',
      isHwTranscode: false,
    };
  }
  // Direct stream (video copy or direct stream)
  if (videoDecision === 'copy' || videoDecision === 'directstream') {
    return {
      label: 'Direct Stream',
      color: colors.info,
      bgColor: 'rgba(59, 130, 246, 0.15)',
      icon: 'arrow-forward',
      isHwTranscode: false,
    };
  }
  // Fallback based on isTranscode flag
  if (session.isTranscode) {
    return {
      label: 'Transcode',
      color: colors.warning,
      bgColor: 'rgba(245, 158, 11, 0.15)',
      icon: isHwTranscode ? 'hardware-chip-outline' : 'flash',
      isHwTranscode,
    };
  }
  return {
    label: 'Direct Play',
    color: colors.success,
    bgColor: 'rgba(34, 197, 94, 0.15)',
    icon: 'play',
    isHwTranscode: false,
  };
}

/**
 * Get device icon based on device/product/platform info
 */
function getDeviceIcon(session: ActiveSession): IoniconsIconName {
  const device = session.device?.toLowerCase() || '';
  const product = session.product?.toLowerCase() || '';
  const platform = session.platform?.toLowerCase() || '';

  // TV devices
  if (
    device.includes('tv') ||
    product.includes('tv') ||
    platform.includes('tv') ||
    product.includes('roku') ||
    product.includes('firetv') ||
    product.includes('fire tv') ||
    product.includes('chromecast') ||
    product.includes('apple tv') ||
    product.includes('android tv')
  ) {
    return 'tv-outline';
  }
  // Tablets
  if (device.includes('ipad') || device.includes('tablet')) {
    return 'tablet-portrait-outline';
  }
  // Phones
  if (
    device.includes('iphone') ||
    device.includes('phone') ||
    device.includes('android') ||
    platform.includes('ios') ||
    platform.includes('android')
  ) {
    return 'phone-portrait-outline';
  }
  // Desktop/Web
  if (
    product.includes('web') ||
    product.includes('plex for windows') ||
    product.includes('plex for mac') ||
    product.includes('plex for linux') ||
    platform.includes('windows') ||
    platform.includes('macos') ||
    platform.includes('linux')
  ) {
    return 'desktop-outline';
  }
  // Default
  return 'hardware-chip-outline';
}

/**
 * Get location string from session
 */
function getLocationString(session: ActiveSession): string | null {
  if (session.geoCity && session.geoCountry) {
    return `${session.geoCity}, ${session.geoCountry}`;
  }
  if (session.geoCountry) {
    return session.geoCountry;
  }
  if (session.geoCity) {
    return session.geoCity;
  }
  return null;
}

export function NowPlayingCard({
  session,
  onPress,
  isMultiServer,
  serverColor,
}: NowPlayingCardProps) {
  const getImageUrl = useImageUrl();
  const { isTablet, select } = useResponsive();
  const { title, subtitle } = getMediaDisplay(session);

  // Use estimated progress for smooth updates between SSE/poll events
  const { estimatedProgressMs, progressPercent } = useEstimatedProgress(session);

  // Responsive sizing
  const posterWidth = select({ base: 50, md: 65 });
  const posterHeight = select({ base: 70, md: 95 });
  const avatarSize = select({ base: 16, md: 20 });

  // Build poster URL using image proxy (request larger size for tablets)
  const posterUrl = getImageUrl({
    serverId: session.serverId,
    path: session.thumbPath,
    width: posterWidth * 2,
    height: posterHeight * 2,
  });

  const isPaused = session.state === 'paused';
  const username = session.user?.username ?? 'Unknown';
  const displayName = session.user?.identityName ?? username;
  const userThumbUrl = session.user?.thumbUrl || null;
  const isDispatcharrCatchup =
    session.server.type === 'dispatcharr' &&
    session.mediaType === 'live' &&
    session.dispatcharrPlaybackKind === 'catchup';

  // Tablet-only info
  const qualityInfo = getQualityInfo(session);
  const deviceIcon = getDeviceIcon(session);
  const location = getLocationString(session);
  const catchupBadgeSize = isTablet ? 18 : 16;
  const catchupIconSize = isTablet ? 14 : 12;

  return (
    <Pressable
      className="bg-card mb-2 overflow-hidden rounded-xl"
      style={({ pressed }) => ({
        ...(pressed && { opacity: 0.7 }),
      })}
      onPress={() => onPress?.(session)}
    >
      {/* Background with poster blur - matches web's blur-xl */}
      {posterUrl && (
        <Image
          source={{ uri: posterUrl }}
          style={[StyleSheet.absoluteFill, { opacity: 0.25 }]}
          blurRadius={40}
          contentFit="cover"
        />
      )}

      {/* Main content row */}
      <View className="flex-row px-2 py-1" style={{ gap: isTablet ? spacing.md : spacing.sm }}>
        {/* Poster */}
        <View className="relative">
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              className="bg-card rounded-lg"
              style={{ width: posterWidth, height: posterHeight }}
              contentFit="cover"
            />
          ) : (
            <View
              className="bg-card items-center justify-center rounded-lg"
              style={{ width: posterWidth, height: posterHeight }}
            >
              <Ionicons name="film-outline" size={isTablet ? 28 : 24} color={colors.icon.default} />
            </View>
          )}
          {/* Play/Pause overlay on poster - like web */}
          {isPaused && (
            <View
              style={StyleSheet.absoluteFill}
              className="items-center justify-center rounded-lg bg-black/60"
            >
              <Ionicons name="pause" size={isTablet ? 24 : 20} color={colors.text.primary.dark} />
            </View>
          )}
        </View>

        {/* Info section — groups spaced apart, tight within */}
        <View className="flex-1" style={{ gap: isTablet ? 10 : 6 }}>
          {/* Title block */}
          <View>
            <View className="flex-row items-center">
              <Text
                className={`flex-1 font-semibold ${isTablet ? 'text-base leading-5' : 'text-sm leading-4'}`}
                numberOfLines={1}
              >
                {title}
              </Text>
              {isDispatcharrCatchup && (
                <View
                  style={{
                    width: catchupBadgeSize,
                    height: catchupBadgeSize,
                    borderRadius: catchupBadgeSize / 2,
                    marginLeft: 4,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.surface.dark,
                  }}
                  accessibilityLabel="Catch-up"
                >
                  <CatchupIcon size={catchupIconSize} color={colors.text.muted.dark} />
                </View>
              )}
              <Ionicons
                name={qualityInfo.icon}
                size={isTablet ? 13 : 11}
                color={qualityInfo.color}
                style={{ marginLeft: 4 }}
              />
              {isTablet && (
                <Ionicons
                  name={deviceIcon}
                  size={14}
                  color={colors.text.muted.dark}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
            {subtitle && (
              <Text
                className={`text-muted-foreground mt-px ${isTablet ? 'text-sm' : 'text-xs'}`}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            )}
          </View>

          {/* User row */}
          <View className="flex-row items-center gap-1">
            <UserAvatar
              thumbUrl={userThumbUrl}
              serverId={session.serverId}
              username={username}
              size={avatarSize}
            />
            <Text className="text-secondary-foreground flex-1 text-xs" numberOfLines={1}>
              {displayName}
            </Text>
            {/* Chevron */}
            <Ionicons
              name="chevron-forward"
              size={isTablet ? 16 : 14}
              color={colors.icon.default}
              style={{ opacity: 0.4 }}
            />
          </View>

          {/* Footer - server name (multi-server) and/or location */}
          {(isMultiServer || (isTablet && location)) && (
            <View className="flex-row items-center gap-1">
              {isMultiServer && (
                <>
                  {serverColor && (
                    <View
                      style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: serverColor }}
                    />
                  )}
                  <Text
                    className="text-muted-foreground text-[10px]"
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {session.server.name}
                  </Text>
                </>
              )}
              {isMultiServer && location && (
                <Text className="text-muted-foreground text-[10px]">·</Text>
              )}
              {location && (
                <View className="flex-row items-center gap-0.5" style={{ flexShrink: 1 }}>
                  <Ionicons name="location-outline" size={9} color={colors.text.muted.dark} />
                  <Text className="text-muted-foreground text-[10px]" numberOfLines={1}>
                    {location}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Progress bar with time labels - like web */}
      <View className="px-2 pb-1">
        <View className="rounded-full" style={{ height: 4, backgroundColor: colors.surface.dark }}>
          <View
            className="rounded-full"
            style={{
              height: '100%',
              width: `${progressPercent}%`,
              backgroundColor: isMultiServer && serverColor ? serverColor : ACCENT_COLOR,
            }}
          />
        </View>
        <View className="mt-0.5 flex-row justify-between">
          <Text className="text-muted-foreground text-[10px]">
            {formatDuration(estimatedProgressMs, { style: 'clock' })}
          </Text>
          {isPaused ? (
            <Text className="text-[10px] font-medium" style={{ color: colors.warning }}>
              Paused
            </Text>
          ) : (
            <Text className="text-muted-foreground text-[10px]">
              {session.totalDurationMs && estimatedProgressMs
                ? `-${formatDuration(session.totalDurationMs - estimatedProgressMs, { style: 'clock' })}`
                : formatDuration(session.totalDurationMs, { style: 'clock' })}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
