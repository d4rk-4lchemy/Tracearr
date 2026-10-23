import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Clock, Flame, History, Play, Tags, Tv, type LucideIcon } from 'lucide-react';
import type { MyStats } from '@tracearr/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHeading } from '@/components/dashboard/SectionHeading';
import { browseHref } from '@/lib/browseLinks';
import { formatDate, formatIsoDay, spanOf } from '@/lib/dateFormat';

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
                detail={formatIsoDay(biggestBinge.day)}
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
                detail={formatDate(new Date(firstPlay.startedAt), { dateStyle: 'medium' })}
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
