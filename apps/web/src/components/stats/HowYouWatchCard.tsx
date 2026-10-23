import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Activity } from 'lucide-react';
import type {
  DayOfWeekStats,
  EngagementTier,
  EngagementTierBreakdown,
  HourOfDayStats,
  UserBehaviorType,
  UserEngagementProfile,
} from '@tracearr/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TIER_COLORS } from '@/components/charts/EngagementChart';
import { SectionHeading } from '@/components/dashboard/SectionHeading';
import { formatHourOfDay, weekdayName } from '@/lib/dateFormat';

type ViewerType = Exclude<UserBehaviorType, 'inactive'>;
type ActiveProfile = UserEngagementProfile & { behaviorType: ViewerType };

const TIER_ORDER: Exclude<EngagementTier, 'unknown'>[] = [
  'abandoned',
  'sampled',
  'engaged',
  'watched',
  'rewatched',
];

/** The profile with the most plays, or undefined when there is none or it is inactive. */
export function activeProfile(
  profiles: UserEngagementProfile[] | undefined
): ActiveProfile | undefined {
  const best = profiles?.reduce<UserEngagementProfile | undefined>(
    (top, p) => (!top || p.totalPlays > top.totalPlays ? p : top),
    undefined
  );
  return best && best.behaviorType !== 'inactive'
    ? { ...best, behaviorType: best.behaviorType }
    : undefined;
}

function busiest<T extends { count: number }>(rows: T[] | undefined): T | undefined {
  return rows?.reduce<T | undefined>(
    (best, row) => (row.count > 0 && (!best || row.count > best.count) ? row : best),
    undefined
  );
}

interface HowYouWatchCardProps {
  profile: ActiveProfile;
  breakdown: EngagementTierBreakdown[] | undefined;
  dayOfWeek: DayOfWeekStats[] | undefined;
  hourOfDay: HourOfDayStats[] | undefined;
  className?: string;
}

export function HowYouWatchCard({
  profile,
  breakdown,
  dayOfWeek,
  hourOfDay,
  className,
}: HowYouWatchCardProps) {
  const { t } = useTranslation('pages');

  const day = busiest(dayOfWeek);
  const hour = busiest(hourOfDay);
  const dayName = day ? weekdayName(day.day, 'long') : null;
  const hourName = hour ? formatHourOfDay(hour.hour) : null;

  const tiers = TIER_ORDER.flatMap((tier) => {
    const row = breakdown?.find((b) => b.tier === tier);
    return row && row.percentage > 0 ? [{ tier, percentage: row.percentage }] : [];
  });

  return (
    <section className={className}>
      <SectionHeading
        icon={Activity}
        title={t('yourStats.howYouWatch')}
        caption={t('yourStats.allTimeCaption')}
      />
      <Card className="gap-4 py-4">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">
            {t(`yourStats.viewerType.${profile.behaviorType}.label`)}
          </CardTitle>
          <CardDescription className="space-y-1">
            <p>
              {t(`yourStats.viewerType.${profile.behaviorType}.desc`, {
                rate: Math.round(profile.completionRate),
              })}
            </p>
            {dayName && hourName && (
              <p>{t('yourStats.habits', { day: dayName, hour: hourName })}</p>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tiers.length > 0 && (
            <>
              <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full">
                {tiers.map((row) => (
                  <div
                    key={row.tier}
                    style={{ width: `${row.percentage}%`, backgroundColor: TIER_COLORS[row.tier] }}
                  />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {tiers.map((row) => (
                  <li key={row.tier} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: TIER_COLORS[row.tier] }}
                    />
                    {t(`yourStats.tier.${row.tier}`)} {Math.round(row.percentage)}%
                  </li>
                ))}
              </ul>
            </>
          )}
          <Link to="/stats/activity" className="text-primary inline-block text-sm hover:underline">
            {t('yourStats.seeActivity')}
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
