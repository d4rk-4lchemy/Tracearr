import { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import type { LocationStats, LocationUserInfo } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { LocalBadge } from '@/components/sessions/LocalBadge';
import { locationKey, locationName } from './locationKey';
import { PersonRow, SectionHeading } from './LocationPanel';

interface AreaPanelProps {
  /** The area's members, largest first. */
  places: LocationStats[];
  onBack: () => void;
  onSelectPlace: (key: string) => void;
  onSelectPerson: (person: LocationUserInfo) => void;
}

/** One entry per identity across the places, counts summed, keeping the first-seen account. */
function mergePeople(places: LocationStats[]): LocationUserInfo[] {
  const merged: { person: LocationUserInfo; ids: Set<string> }[] = [];
  for (const place of places) {
    for (const person of place.users ?? []) {
      const entry = merged.find((m) => person.serverUserIds.some((id) => m.ids.has(id)));
      if (entry) {
        entry.person = { ...entry.person, count: entry.person.count + person.count };
        for (const id of person.serverUserIds) entry.ids.add(id);
      } else {
        merged.push({ person, ids: new Set(person.serverUserIds) });
      }
    }
  }
  return merged.map((m) => m.person).sort((a, b) => b.count - a.count);
}

export function AreaPanel({ places, onBack, onSelectPlace, onSelectPerson }: AreaPanelProps) {
  const { t } = useTranslation(['pages', 'nav']);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    panel?.addEventListener('keydown', onKeyDown);
    return () => panel?.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  const ranked = useMemo(() => [...places].sort((a, b) => b.count - a.count), [places]);
  const people = useMemo(() => mergePeople(ranked), [ranked]);
  const largest = ranked[0];
  const total = ranked.reduce((sum, l) => sum + l.count, 0);

  return (
    <section ref={panelRef} aria-labelledby={headingId} className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b px-4 pt-3 pb-3.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 h-7 gap-1.5 px-2 text-xs"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('map.allLocations')}
        </Button>
        <div>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            {t('map.areaName', { name: largest ? locationName(largest) : '' })}
          </h2>
          <div className="text-muted-foreground mt-0.5 text-sm">
            {t('map.streamsAcrossPlaces', { count: total, places: ranked.length })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 scrollbar-thin space-y-4 overflow-auto px-4 py-3.5">
        <section>
          <SectionHeading>{t('map.areaPlaces')}</SectionHeading>
          <div data-testid="area-places" className="-mx-2 flex flex-col">
            {ranked.map((place) => (
              <PlaceRow
                key={locationKey(place)}
                place={place}
                onSelect={() => onSelectPlace(locationKey(place))}
              />
            ))}
          </div>
        </section>
        {people.length > 0 && (
          <section>
            <SectionHeading>{t('nav:people')}</SectionHeading>
            <div data-testid="area-people" className="-mx-2 flex flex-col">
              {people.map((person) => (
                <PersonRow key={person.id} person={person} onSelect={onSelectPerson} />
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

function PlaceRow({ place, onSelect }: { place: LocationStats; onSelect: () => void }) {
  const { t } = useTranslation(['pages']);
  const region = [place.region, place.country].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      className="hover:bg-muted/60 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{locationName(place)}</span>
          <LocalBadge isLocal={place.isLocal} country={place.country} />
        </div>
        <div className="text-muted-foreground truncate text-xs">{region}</div>
      </div>
      <span className="text-muted-foreground shrink-0 text-xs">
        {t('map.streamCount', { count: place.count })}
      </span>
    </button>
  );
}
