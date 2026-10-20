import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Monitor } from 'lucide-react';
import type { UserDevice, UserLocation, UserRangeStats } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LocalBadge } from '@/components/sessions/LocalBadge';
import { UserDevicesCard } from '@/components/users/UserDevicesCard';
import { UserLocationsCard } from '@/components/users/UserLocationsCard';
import { formatLocationCompact } from '@/lib/utils';

interface WhereCardProps {
  devices: UserRangeStats['devices'] | undefined;
  locations: UserRangeStats['locations'] | undefined;
  localShare: number | null | undefined;
  /** All-time lists behind "view all". */
  allDevices: UserDevice[];
  allLocations: UserLocation[];
  totalSessions: number;
}

export function WhereCard({
  devices = [],
  locations = [],
  localShare,
  allDevices,
  allLocations,
  totalSessions,
}: WhereCardProps) {
  const { t } = useTranslation(['pages', 'common']);
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pages:userDetail.overview.where')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {devices.length === 0 && locations.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('common:empty.noData')}</p>
        )}

        {devices.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {devices.map((device) => (
              <li key={`${device.device}-${device.platform}`} className="flex items-center gap-2">
                <Monitor className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {device.device}
                  {device.platform && (
                    <span className="text-muted-foreground"> · {device.platform}</span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {t('common:count.session', { count: device.sessions })}
                  {device.directPlayRate !== null &&
                    ` · ${t('pages:userDetail.overview.directPlayShare', {
                      value: Math.round(device.directPlayRate),
                    })}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {locations.length > 0 && (
          <div className="space-y-1.5">
            {localShare != null && (
              <p className="text-muted-foreground text-xs">
                {t('pages:userDetail.overview.localShare', { value: Math.round(localShare) })}
              </p>
            )}
            <ul className="space-y-1.5 text-sm">
              {locations.map((location) => (
                <li
                  key={`${location.city}-${location.region}-${location.country}-${location.isLocal}`}
                  className="flex items-center gap-2"
                >
                  <MapPin className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {formatLocationCompact(location.city, location.region, location.country) ??
                      t('common:labels.unknown')}
                  </span>
                  <LocalBadge isLocal={location.isLocal} country={location.country} />
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t('common:count.session', { count: location.sessions })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(allDevices.length > 0 || allLocations.length > 0) && (
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setOpen(true)}>
            {t('pages:userDetail.overview.viewAllDevices')}
          </Button>
        )}
      </CardContent>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('pages:userDetail.overview.where')}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <UserDevicesCard devices={allDevices} totalSessions={totalSessions} />
            <UserLocationsCard locations={allLocations} totalSessions={totalSessions} />
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
