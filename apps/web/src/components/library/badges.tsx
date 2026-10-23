import { Film, Tv, Music, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Get completion rate badge based on percentage.
 */
export function getCompletionBadge(rate: number) {
  if (rate >= 80) return <Badge variant="success">{rate.toFixed(0)}%</Badge>;
  if (rate >= 50) return <Badge variant="secondary">{rate.toFixed(0)}%</Badge>;
  if (rate >= 20) return <Badge variant="warning">{rate.toFixed(0)}%</Badge>;
  return <Badge variant="outline">{rate.toFixed(0)}%</Badge>;
}

interface MediaTypeBadgeConfig {
  icon: LucideIcon;
  labelKey: 'media.movie' | 'media.tv' | 'media.music';
  className: string;
}

const MOVIE_BADGE: MediaTypeBadgeConfig = { icon: Film, labelKey: 'media.movie', className: '' };
const TV_BADGE: MediaTypeBadgeConfig = {
  icon: Tv,
  labelKey: 'media.tv',
  className: 'bg-blue-500/10 text-blue-500',
};
const MUSIC_BADGE: MediaTypeBadgeConfig = {
  icon: Music,
  labelKey: 'media.music',
  className: 'bg-purple-500/10 text-purple-500',
};

/** Leaves carry their parent's badge: an episode reads TV, a track reads Music. */
const MEDIA_TYPE_BADGES: Record<string, MediaTypeBadgeConfig> = {
  movie: MOVIE_BADGE,
  show: TV_BADGE,
  episode: TV_BADGE,
  artist: MUSIC_BADGE,
  track: MUSIC_BADGE,
};

/**
 * Badge component for media type (Movie, TV, Music)
 */
export function MediaTypeBadge({ mediaType }: { mediaType: string }) {
  const { t } = useTranslation('common');
  const badge = MEDIA_TYPE_BADGES[mediaType];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <Badge variant="secondary" className={cn('gap-1', badge.className)}>
      <Icon className="h-3 w-3" />
      {t(badge.labelKey)}
    </Badge>
  );
}
