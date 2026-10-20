import { useTranslation } from 'react-i18next';
import { PieChart, Tags, TrendingDown, TrendingUp } from 'lucide-react';
import type { GenreRow } from '@tracearr/shared';
import { StatCard } from '@/components/ui/stat-card';
import { formatNumber, formatPercent } from '@/lib/formatters';
import { deltaPercent } from '@/lib/periodWindows';

const signed = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero' });

interface Change {
  genre: string;
  diff: number;
  pct: number | null;
}

function largestMove(rows: GenreRow[], sign: 1 | -1): Change | null {
  let best: Change | null = null;
  for (const row of rows) {
    if (row.priorPlays === null) continue;
    const diff = row.plays - row.priorPlays;
    if (diff * sign > 0 && (best === null || diff * sign > best.diff * sign)) {
      best = { genre: row.genre, diff, pct: deltaPercent(row.plays, row.priorPlays) };
    }
  }
  return best;
}

export function GenreStatCards({ rows }: { rows: GenreRow[] }) {
  const { t } = useTranslation(['pages', 'common']);

  const withPlays = rows.filter((row) => row.plays > 0).length;
  // A title carries several genres, so the five are measured against the plays every genre holds.
  const genrePlays = rows.reduce((sum, row) => sum + row.plays, 0);
  const topFive = [...rows]
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 5)
    .reduce((sum, row) => sum + row.plays, 0);

  const moveCard = (move: Change | null) => ({
    value: move === null ? '—' : signed.format(move.diff),
    subValue: move?.genre,
    delta:
      move && move.pct !== null
        ? { value: move.pct, label: t('pages:userDetail.cards.vsPrior') }
        : undefined,
  });

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={Tags}
        label={t('pages:media.genres.cards.withPlays')}
        value={formatNumber(withPlays)}
        valueSuffix={t('pages:media.genres.cards.ofGenres', { count: rows.length })}
      />
      <StatCard
        icon={PieChart}
        label={t('pages:media.genres.cards.topFiveShare')}
        value={genrePlays > 0 ? formatPercent((topFive / genrePlays) * 100, 0) : '—'}
      />
      <StatCard
        icon={TrendingUp}
        label={t('pages:media.genres.cards.largestRise')}
        {...moveCard(largestMove(rows, 1))}
      />
      <StatCard
        icon={TrendingDown}
        label={t('pages:media.genres.cards.largestFall')}
        {...moveCard(largestMove(rows, -1))}
      />
    </div>
  );
}
