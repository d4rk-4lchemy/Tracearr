import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Clock, Flame, History, Play, Tags, Tv, type LucideIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { MyStats } from '@tracearr/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHeading } from '@/components/dashboard/SectionHeading';
import { browseHref } from '@/lib/browseLinks';

function Moment({
  icon: Icon,
  label,
  detail,
  children,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
      <span className="text-muted-foreground flex shrink-0 items-center gap-2">
        <Icon className="text-primary h-4 w-4" />
        {label}
      </span>
      <span className="min-w-0 text-right">
        <span className="font-semibold">{children}</span>
        {detail && <span className="text-muted-foreground block text-xs">{detail}</span>}
      </span>
    </li>
  );
}

function MaybeLink({ to, children }: { to: string | null; children: ReactNode }) {
  return to ? (
    <Link to={to} className="hover:underline">
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** One unit that grows with the total: minutes, then hours, days from two days, weeks from two weeks. */
function spanOf(ms: number): { unit: 'minutes' | 'hours' | 'days' | 'weeks'; count: number } {
  const round = (value: number) => Math.round(value * 10) / 10;
  if (ms < HOUR_MS) return { unit: 'minutes', count: Math.round(ms / 60_000) };
  if (ms < 2 * DAY_MS) return { unit: 'hours', count: round(ms / HOUR_MS) };
  if (ms < 2 * WEEK_MS) return { unit: 'days', count: round(ms / DAY_MS) };
  return { unit: 'weeks', count: round(ms / WEEK_MS) };
}

export function AllTimeSection({ stats, className }: { stats: MyStats; className?: string }) {
  const { t } = useTranslation('pages');
  const { firstPlay, biggestBinge, topGenres } = stats;
  const span = stats.totalWatchTimeMs > 0 ? spanOf(stats.totalWatchTimeMs) : null;

  return (
    <section className={className}>
      <SectionHeading icon={History} title={t('yourStats.allTime')} />
      <Card className="py-4">
        <CardContent>
          <ul className="divide-y">
            {span && (
              <Moment icon={Clock} label={t('yourStats.watchTime')}>
                {t(`yourStats.span.${span.unit}`, { count: span.count })}
              </Moment>
            )}
            <Moment icon={Flame} label={t('yourStats.longestStreak')}>
              {t('yourStats.days', { count: stats.longestStreak })}
            </Moment>
            {biggestBinge && (
              <Moment
                icon={Tv}
                label={t('yourStats.biggestBinge')}
                detail={format(parseISO(biggestBinge.day), 'MMM d, yyyy')}
              >
                <MaybeLink
                  to={biggestBinge.showMediaId ? `/media/${biggestBinge.showMediaId}` : null}
                >
                  {t('yourStats.bingeValue', {
                    count: biggestBinge.episodes,
                    show: biggestBinge.showTitle,
                  })}
                </MaybeLink>
              </Moment>
            )}
            {firstPlay && (
              <Moment
                icon={Play}
                label={t('yourStats.firstPlay')}
                detail={format(new Date(firstPlay.startedAt), 'MMM d, yyyy')}
              >
                <MaybeLink to={firstPlay.mediaId ? `/media/${firstPlay.mediaId}` : null}>
                  {firstPlay.grandparentTitle
                    ? `${firstPlay.grandparentTitle}: ${firstPlay.mediaTitle}`
                    : firstPlay.mediaTitle}
                </MaybeLink>
              </Moment>
            )}
            {topGenres.length > 0 && (
              <Moment icon={Tags} label={t('yourStats.topGenres')}>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {topGenres.map((genre) => (
                    <Badge key={genre.genre} variant="secondary" asChild>
                      <Link to={browseHref('movie', { genre: genre.genre })}>{genre.genre}</Link>
                    </Badge>
                  ))}
                </span>
              </Moment>
            )}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
