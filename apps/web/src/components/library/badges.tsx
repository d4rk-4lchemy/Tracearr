import { Film, Tv, Music } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Get binge score badge based on score thresholds.
 */
export function getBingeScoreBadge(score: number) {
  if (score >= 80) return <Badge variant="danger">Highly Addictive</Badge>;
  if (score >= 60) return <Badge variant="warning">Addictive</Badge>;
  if (score >= 40) return <Badge variant="secondary">Bingeable</Badge>;
  return <Badge variant="outline">Casual Watch</Badge>;
}

/**
 * Get completion rate badge based on percentage.
 */
export function getCompletionBadge(rate: number) {
  if (rate >= 80) return <Badge variant="success">{rate.toFixed(0)}%</Badge>;
  if (rate >= 50) return <Badge variant="secondary">{rate.toFixed(0)}%</Badge>;
  if (rate >= 20) return <Badge variant="warning">{rate.toFixed(0)}%</Badge>;
  return <Badge variant="outline">{rate.toFixed(0)}%</Badge>;
}

const MOVIE_BADGE = { icon: Film, label: 'Movie', className: '' };
const TV_BADGE = { icon: Tv, label: 'TV', className: 'bg-blue-500/10 text-blue-500' };
const MUSIC_BADGE = { icon: Music, label: 'Music', className: 'bg-purple-500/10 text-purple-500' };

/** Leaves carry their parent's badge: an episode reads TV, a track reads Music. */
const MEDIA_TYPE_BADGES: Record<string, typeof MOVIE_BADGE> = {
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
  const badge = MEDIA_TYPE_BADGES[mediaType];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <Badge variant="secondary" className={cn('gap-1', badge.className)}>
      <Icon className="h-3 w-3" />
      {badge.label}
    </Badge>
  );
}
