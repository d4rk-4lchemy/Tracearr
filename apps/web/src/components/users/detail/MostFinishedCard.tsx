import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { UserRangeStats } from '@tracearr/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PosterThumb } from '@/components/media-browse/PosterThumb';

export function MostFinishedCard({ items }: { items: UserRangeStats['mostFinished'] | undefined }) {
  const { t } = useTranslation(['pages', 'common']);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pages:userDetail.overview.mostFinished')}</CardTitle>
      </CardHeader>
      <CardContent>
        {items && items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.mediaId}>
                <Link
                  to={`/media/${item.mediaId}`}
                  className="hover:bg-muted/50 flex items-center gap-3 rounded-md p-1 transition-colors"
                >
                  <PosterThumb serverId={item.serverId} thumbPath={item.thumbPath} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.title}</span>
                    <span className="text-muted-foreground block text-xs">
                      {t('pages:userDetail.overview.finishedCount', { count: item.finished })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t('common:empty.noData')}</p>
        )}
      </CardContent>
    </Card>
  );
}
