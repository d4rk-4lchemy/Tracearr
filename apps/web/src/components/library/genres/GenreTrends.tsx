import { useTranslation } from 'react-i18next';
import type { GenreRow } from '@tracearr/shared';
import { Sparkline } from '@/components/charts/Sparkline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDelta } from '@/lib/periodWindows';

const SHOWN = 8;

/** Small multiples: the busiest genres' plays across the range, each with its change on the prior. */
export function GenreTrends({ rows }: { rows: GenreRow[] }) {
  const { t } = useTranslation(['pages', 'common']);
  const top = rows
    .filter((row) => row.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, SHOWN);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pages:media.genres.trends.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('common:empty.noPlayData')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {top.map((row) => (
              <li key={row.genre} className="min-w-0 space-y-1">
                <div className="truncate text-sm font-medium">{row.genre}</div>
                <div className="h-7">
                  <Sparkline values={row.trend} width={120} height={28} className="w-full" />
                </div>
                <div className="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums">
                  <span>{t('common:count.play', { count: row.plays })}</span>
                  <span>{formatDelta(row.plays, row.priorPlays) ?? '—'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
