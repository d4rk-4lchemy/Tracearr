import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GenreRow, GenresResponse } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const COLLAPSED = 12;

type ShareSort = 'plays' | 'gap';

interface ShareRow {
  genre: string;
  itemShare: number;
  playShare: number;
  plays: number;
}

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** A percent bar drawn against `scale`, the value the full width stands for. */
export function ShareBar({
  value,
  scale,
  className,
}: {
  value: number;
  scale: number;
  className: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full', className)}
          style={{ width: `${scale > 0 ? (value / scale) * 100 : 0}%` }}
        />
      </div>
      <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
        {formatPercent(value)}
      </span>
    </div>
  );
}

interface ShareBarsProps {
  rows: GenreRow[];
  totals: GenresResponse['totals'];
}

/** Each genre's share of the items beside its share of the plays in the range. */
export function ShareBars({ rows, totals }: ShareBarsProps) {
  const { t } = useTranslation(['pages', 'common']);
  const [sort, setSort] = useState<ShareSort>('plays');
  const [expanded, setExpanded] = useState(false);

  const sorted = rows
    .map<ShareRow>((row) => ({
      genre: row.genre,
      itemShare: share(row.itemCount, totals.items),
      playShare: share(row.plays, totals.plays),
      plays: row.plays,
    }))
    .sort((a, b) =>
      sort === 'gap'
        ? Math.abs(b.playShare - b.itemShare) - Math.abs(a.playShare - a.itemShare)
        : b.plays - a.plays
    );
  const visible = expanded ? sorted : sorted.slice(0, COLLAPSED);
  const scale = Math.max(0, ...sorted.flatMap((row) => [row.itemShare, row.playShare]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pages:media.genres.share.title')}</CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={sort}
            onValueChange={(next) => {
              if (next === 'plays' || next === 'gap') setSort(next);
            }}
            aria-label={t('common:actions.sort')}
          >
            <ToggleGroupItem value="plays">{t('common:labels.plays')}</ToggleGroupItem>
            <ToggleGroupItem value="gap">{t('pages:media.genres.share.sortGap')}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-muted-foreground flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="bg-muted-foreground/50 size-2 rounded-full" />
            {t('pages:media.genres.share.items')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="bg-primary size-2 rounded-full" />
            {t('pages:media.genres.share.plays')}
          </span>
        </div>
        <ul className="space-y-3">
          {visible.map((row) => (
            <li
              key={row.genre}
              data-genre={row.genre}
              className="grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3"
            >
              <span className="truncate text-sm font-medium">{row.genre}</span>
              <div className="space-y-1">
                <ShareBar value={row.itemShare} scale={scale} className="bg-muted-foreground/50" />
                <ShareBar value={row.playShare} scale={scale} className="bg-primary" />
              </div>
            </li>
          ))}
        </ul>
        {sorted.length > COLLAPSED && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((open) => !open)}>
            {expanded
              ? t('common:actions.showLess')
              : t('pages:media.genres.share.showAll', { count: sorted.length })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
