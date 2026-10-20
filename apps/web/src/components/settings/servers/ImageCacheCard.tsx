import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useImageCacheStatus } from '@/hooks/queries';
import { formatBytes, safeFormatDistanceToNow } from '@/lib/formatters';
import type { ImageCacheStatus } from '@tracearr/shared';

/** Read back off the payload rather than hardcoded, so the hint can never
 *  disagree with the per-poster figure the server used for the total. */
function perPosterBytes(status: ImageCacheStatus): number {
  return status.postersWithThumb > 0 ? status.estimatedNeedBytes / status.postersWithThumb : 0;
}

/**
 * What the poster cache holds on disk, what it estimates it needs, and whether the
 * disk floor has kicked in and stopped it from growing.
 */
export function ImageCacheCard() {
  const { t } = useTranslation('settings');
  const { data: status, isLoading, isError } = useImageCacheStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          {t('general.imageCache.title')}
        </CardTitle>
        <CardDescription>{t('general.imageCache.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-muted-foreground text-sm">{t('general.imageCache.loadError')}</p>
        ) : isLoading || !status ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('general.imageCache.size')}</dt>
              <dd>{formatBytes(status.bytes)}</dd>

              <dt className="text-muted-foreground">{t('general.imageCache.files')}</dt>
              <dd>{status.files}</dd>

              <dt className="text-muted-foreground">{t('general.imageCache.need')}</dt>
              <dd>
                {formatBytes(status.estimatedNeedBytes)}{' '}
                <span className="text-muted-foreground">
                  (
                  {t('general.imageCache.needHint', {
                    count: status.postersWithThumb,
                    size: formatBytes(perPosterBytes(status)),
                  })}
                  )
                </span>
              </dd>

              <dt className="text-muted-foreground">{t('general.imageCache.free')}</dt>
              <dd>
                {formatBytes(status.freeBytes)}{' '}
                <span className="text-muted-foreground">
                  {t('general.imageCache.freeOf', { total: formatBytes(status.totalBytes) })}
                </span>
              </dd>

              <dt className="text-muted-foreground">{t('general.imageCache.floor')}</dt>
              <dd>{status.minFreePercent}%</dd>

              {status.maxBytes !== null && (
                <>
                  <dt className="text-muted-foreground">{t('general.imageCache.ceiling')}</dt>
                  <dd>{formatBytes(status.maxBytes)}</dd>
                </>
              )}

              <dt className="text-muted-foreground">{t('general.imageCache.lastSweep')}</dt>
              <dd>
                {status.sweptAt
                  ? safeFormatDistanceToNow(status.sweptAt)
                  : t('general.imageCache.never')}
              </dd>

              <dt className="text-muted-foreground">{t('general.imageCache.swept')}</dt>
              <dd>{status.deletedFilesLastSweep}</dd>

              <dt className="text-muted-foreground">{t('general.imageCache.freed')}</dt>
              <dd>{formatBytes(status.freedBytesLastSweep)}</dd>
            </dl>

            {status.notPersisting && (
              <p className="text-destructive mt-3 text-sm">
                {t('general.imageCache.notPersisting')}
              </p>
            )}

            {status.diskLimitedSince && (
              <p className="text-destructive mt-3 text-sm">
                {t('general.imageCache.diskLimited', {
                  since: safeFormatDistanceToNow(status.diskLimitedSince),
                  shortfall: formatBytes(status.shortfallBytes),
                })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
