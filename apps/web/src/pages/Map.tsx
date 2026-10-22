import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { LocationStats, LocationUserInfo } from '@tracearr/shared';
const StreamMap = lazy(() =>
  import('@/components/map/StreamMap').then((m) => ({ default: m.StreamMap }))
);
import { AreaPanel } from '@/components/map/AreaPanel';
import { LocationList } from '@/components/map/LocationList';
import { LocationPanel } from '@/components/map/LocationPanel';
import {
  locationHistoryFilters,
  locationHistoryParams,
  locationKey,
} from '@/components/map/locationKey';
import { hasMapPosition, type ViewBounds } from '@/components/map/maplibre';
import { ServerLegend } from '@/components/server';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimeRangePicker } from '@/components/ui/time-range-picker';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { X, Flame, CircleDot } from 'lucide-react';
import { ErrorState } from '@/components/library/ErrorState';
import { useLocationPeople, useLocationStats } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useServerColorMap } from '@/hooks/useServerColorMap';
import { resolveWindow, useTimeRange } from '@/hooks/useTimeRange';
import type { LocationPeopleSelector } from '@/lib/api';

type Selection = { kind: 'place'; key: string } | { kind: 'area'; members: string[] } | null;

export function Map() {
  const { t } = useTranslation(['pages', 'common', 'nav']);
  const [searchParams, setSearchParams] = useSearchParams();
  const { value: timeRange, setValue: setTimeRange, apiParams: rangeParams } = useTimeRange();
  const { selectedServerIds, selectedServers, isMultiServer } = useServer();
  const serverColorMap = useServerColorMap();

  const MEDIA_TYPES = useMemo(
    () =>
      [
        { value: 'movie', label: t('common:media.movie_plural') },
        { value: 'episode', label: t('common:media.tv') },
        { value: 'track', label: t('common:media.music') },
      ] as const,
    [t]
  );

  // Parse filters from URL, use selected servers from context
  const filters = useMemo(() => {
    const serverUserId = searchParams.get('serverUserId');
    // Additive: the full set of a merged person's account ids, captured at
    // selection time so their whole history (not just the representative
    // account) is filtered. Falls back to the single id for older links.
    const serverUserIdsParam = searchParams.get('serverUserIds');
    const serverUserIds = serverUserIdsParam
      ? serverUserIdsParam.split(',').filter(Boolean)
      : undefined;
    const mediaType = searchParams.get('mediaType') as 'movie' | 'episode' | 'track' | null;
    const viewMode: 'heatmap' | 'circles' =
      searchParams.get('view') === 'heatmap' ? 'heatmap' : 'circles';

    return {
      serverUserId: serverUserId || undefined,
      serverUserIds,
      mediaType: mediaType || undefined,
      viewMode,
    };
  }, [searchParams]);

  // Build API params including time range
  const apiParams = useMemo(
    () => ({
      timeRange: rangeParams,
      serverUserId: filters.serverUserId,
      serverUserIds: filters.serverUserIds,
      serverIds: selectedServerIds.length ? selectedServerIds : undefined,
      mediaType: filters.mediaType,
    }),
    [rangeParams, filters, selectedServerIds]
  );

  const filterKey = useMemo(() => JSON.stringify(apiParams), [apiParams]);

  // Fetch data - includes available filter options based on current filters
  const {
    data: locationData,
    isLoading: locationsLoading,
    isError: locationsError,
    error: locationsErrorObj,
    refetch: refetchLocations,
  } = useLocationStats(apiParams);

  const locations = useMemo(() => locationData?.data ?? [], [locationData]);
  const summary = locationData?.summary;
  const availableFilters = locationData?.availableFilters;

  // Dynamic filter options from the response
  const users = useMemo(() => availableFilters?.users ?? [], [availableFilters]);
  const mediaTypes = availableFilters?.mediaTypes ?? [];

  // Get selected filter labels for display
  const selectedUser = users.find((u) => u.id === filters.serverUserId);
  const selectedMediaType = MEDIA_TYPES.find((m) => m.value === filters.mediaType);

  // Filter MEDIA_TYPES to only show available options
  const availableMediaTypeOptions = MEDIA_TYPES.filter((m) => mediaTypes.includes(m.value));

  const serverNameMap = useMemo(
    () => Object.fromEntries(selectedServers.map((s) => [s.id, s.name])),
    [selectedServers]
  );

  // If the selected person drops out of the option list (e.g. a server or media
  // type change narrows the context so they no longer have matching activity),
  // clear the stale selection instead of silently filtering on a vanished id.
  useEffect(() => {
    if (!filters.serverUserId || locationsLoading || !availableFilters) return;
    if (users.some((u) => u.id === filters.serverUserId)) return;
    const params = new URLSearchParams(searchParams);
    params.delete('serverUserId');
    params.delete('serverUserIds');
    setSearchParams(params, { replace: true });
  }, [
    filters.serverUserId,
    users,
    locationsLoading,
    availableFilters,
    searchParams,
    setSearchParams,
  ]);

  // Update a single filter
  const setFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    setSearchParams(params, { replace: true });
  };

  // The user filter also captures the person's full account set so filtering
  // covers a merged identity's history across every server, not just the
  // representative account shown in the dropdown.
  const writeUserFilter = (id: string | null, ids: string[] = []) => {
    const params = new URLSearchParams(searchParams);
    if (id === null) {
      params.delete('serverUserId');
      params.delete('serverUserIds');
    } else {
      params.set('serverUserId', id);
      params.set('serverUserIds', (ids.length ? ids : [id]).join(','));
    }
    setSearchParams(params, { replace: true });
  };

  const setUserFilter = (value: string) => {
    if (value === '_all') writeUserFilter(null);
    else writeUserFilter(value, users.find((u) => u.id === value)?.serverUserIds);
  };

  // A location's person is the representative among the accounts seen there, which can
  // differ from the dropdown's id for the same merged person; the stale-filter effect
  // above would clear an id the dropdown does not list.
  const selectPerson = (person: LocationUserInfo) => {
    const entry = users.find((u) =>
      u.serverUserIds.some((id) => person.serverUserIds.includes(id))
    );
    if (entry) writeUserFilter(entry.id, entry.serverUserIds);
    else writeUserFilter(person.id, person.serverUserIds);
  };

  const setViewMode = (mode: 'heatmap' | 'circles') => {
    setFilter('view', mode === 'heatmap' ? 'heatmap' : null);
  };

  const [hovered, setHovered] = useState<readonly string[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<ViewBounds | null>(null);
  const [fitAllSignal, setFitAllSignal] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const hoveredKeys = useMemo(() => new Set(hovered), [hovered]);
  const hoverPlaces = useCallback(
    (keys: readonly string[] | null) =>
      setHovered((prev) => {
        const next = keys ?? [];
        return next.length === prev.length && next.every((k, i) => k === prev[i]) ? prev : next;
      }),
    []
  );
  const hoverRow = useCallback(
    (key: string | null) => hoverPlaces(key === null ? null : [key]),
    [hoverPlaces]
  );
  const selectPlace = useCallback((key: string) => setSelection({ kind: 'place', key }), []);
  const selectArea = useCallback(
    (members: string[]) => setSelection({ kind: 'area', members }),
    []
  );

  const selectedKeys = useMemo(
    () =>
      selection === null ? [] : selection.kind === 'place' ? [selection.key] : selection.members,
    [selection]
  );
  const selectedMembers = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const byKey = useMemo(
    () => new globalThis.Map(locations.map((l) => [locationKey(l), l] as const)),
    [locations]
  );
  const selectedFound = useMemo(
    () => selectedKeys.flatMap((k) => byKey.get(k) ?? []),
    [selectedKeys, byKey]
  );

  // While a refetch is in flight the panel keeps what it showed. Once the new results are in,
  // members missing from them drop out: one left becomes that place, none returns the list.
  const [lastSelected, setLastSelected] = useState<LocationStats[]>([]);
  if (selectedFound.length > 0 && selectedFound !== lastSelected) setLastSelected(selectedFound);
  if (selectedFound.length < selectedKeys.length && !locationsLoading && locationData) {
    const [only] = selectedFound;
    if (only === undefined) setSelection(null);
    else if (selectedFound.length === 1) setSelection({ kind: 'place', key: locationKey(only) });
    else setSelection({ kind: 'area', members: selectedFound.map(locationKey) });
  }
  const shown = useMemo(
    () =>
      selectedFound.length > 0
        ? selectedFound
        : selection !== null && locationsLoading
          ? lastSelected
          : [],
    [selectedFound, selection, locationsLoading, lastSelected]
  );

  // The list carries a few people per place; the panel fetches all of them and shows the list's
  // until they arrive. An area's members are all placed, so the box around them covers it.
  const peopleOf = useMemo((): LocationPeopleSelector | null => {
    if (selection?.kind === 'place') return { place: selection.key };
    const placed = shown.filter(hasMapPosition);
    const [first] = placed;
    if (first === undefined) return null;
    const box = { west: first.lon, south: first.lat, east: first.lon, north: first.lat };
    for (const l of placed) {
      box.west = Math.min(box.west, l.lon);
      box.south = Math.min(box.south, l.lat);
      box.east = Math.max(box.east, l.lon);
      box.north = Math.max(box.north, l.lat);
    }
    return box;
  }, [selection, shown]);
  const { data: people } = useLocationPeople(apiParams, peopleOf);
  const panelPlaces = useMemo(() => {
    const full = new globalThis.Map(people?.data.map((l) => [locationKey(l), l.users] as const));
    return shown.map((l) => {
      const users = full.get(locationKey(l));
      return users ? { ...l, users } : l;
    });
  }, [shown, people]);
  const selectedLocation = selection?.kind === 'place' ? panelPlaces[0] : undefined;
  const selectedArea =
    selection?.kind === 'area' && panelPlaces.length > 0 ? panelPlaces : undefined;

  const closePanel = () => {
    const [key] = selectedKeys;
    flushSync(() => setSelection(null));
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [];
    Array.from(rows)
      .find((row) => row.dataset.key === key)
      ?.focus();
  };

  const { startDate: rangeStart, endDate: rangeEnd } = rangeParams;
  const dateWindow = useMemo(
    () => resolveWindow(timeRange.period, rangeStart, rangeEnd),
    [timeRange.period, rangeStart, rangeEnd]
  );
  const mapServerIds = selectedServerIds.length ? selectedServerIds : undefined;
  const mapServerUserIds =
    filters.serverUserIds ?? (filters.serverUserId ? [filters.serverUserId] : undefined);

  // Clear all filters (except time range which has its own controls)
  const clearFilters = () => {
    const params = new URLSearchParams();
    for (const key of ['period', 'from', 'to']) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  };

  // Check if any non-time filters are active
  const hasFilters = filters.serverUserId || filters.mediaType;

  // Build summary text
  const summaryContext = useMemo(() => {
    const parts: string[] = [];
    if (selectedUser) parts.push(selectedUser.identityName ?? selectedUser.username);
    if (selectedMediaType) parts.push(selectedMediaType.label);
    return parts.join(' · ') || t('map.allActivity');
  }, [selectedUser, selectedMediaType, t]);

  const hasData = locations.length > 0;

  return (
    <div className="-m-6 flex h-[calc(100vh-3rem)] flex-col md:h-screen">
      {/* Filter bar */}
      <div className="bg-card/50 relative z-20 flex items-center gap-3 border-b px-4 py-2 backdrop-blur">
        <h1 className="sr-only">{t('nav:map')}</h1>
        {/* Time range picker */}
        <TimeRangePicker value={timeRange} onChange={setTimeRange} />

        <div className="bg-border h-4 w-px" />

        {/* User filter */}
        <Select value={filters.serverUserId ?? '_all'} onValueChange={setUserFilter}>
          <SelectTrigger className="h-8 w-[140px] text-sm">
            <SelectValue placeholder={t('map.allUsers')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t('map.allUsers')}</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.identityName ?? user.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Media type filter */}
        <Select
          value={filters.mediaType ?? '_all'}
          onValueChange={(v) => setFilter('mediaType', v === '_all' ? null : v)}
        >
          <SelectTrigger className="h-8 min-w-[100px] text-sm">
            <SelectValue placeholder={t('map.allTypes')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t('map.allTypes')}</SelectItem>
            {availableMediaTypeOptions.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground hover:text-foreground h-8 px-2"
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <div className="bg-border h-4 w-px" />

        {/* View mode toggle */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filters.viewMode}
          onValueChange={(mode) => {
            if (mode === 'heatmap' || mode === 'circles') setViewMode(mode);
          }}
          aria-label={t('map.viewMode')}
        >
          <ToggleGroupItem value="heatmap" className="gap-1.5 px-2.5 text-xs">
            <Flame className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('map.heatmap')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="circles" className="gap-1.5 px-2.5 text-xs">
            <CircleDot className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('map.circles')}</span>
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Summary stats - right side */}
        <div className="ml-auto flex items-center gap-4 text-sm">
          <div className="text-muted-foreground">{summaryContext}</div>
          <div className="flex items-center gap-3">
            <div>
              <span className="font-semibold tabular-nums">{summary?.totalStreams ?? 0}</span>
              <span className="text-muted-foreground ml-1">{t('map.streams')}</span>
            </div>
            <div className="bg-border h-4 w-px" />
            <div>
              <span className="font-semibold tabular-nums">{summary?.uniqueLocations ?? 0}</span>
              <span className="text-muted-foreground ml-1">{t('map.locations')}</span>
            </div>
          </div>
        </div>
      </div>

      {locationsError ? (
        <div className="relative flex-1">
          <ErrorState
            title={t('common:errors.somethingWentWrong')}
            message={locationsErrorObj?.message ?? t('common:errors.unexpectedError')}
            onRetry={() => void refetchLocations()}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative min-h-0 flex-1">
            <Suspense fallback={<div className="bg-muted/30 h-full w-full animate-pulse" />}>
              <StreamMap
                locations={locations}
                isLoading={locationsLoading}
                viewMode={filters.viewMode}
                filterKey={filterKey}
                serverColorMap={serverColorMap}
                isMultiServer={isMultiServer}
                hoveredKeys={hoveredKeys}
                selectedMembers={selectedMembers}
                onHover={hoverPlaces}
                onSelect={selectPlace}
                onSelectArea={selectArea}
                onViewChange={setView}
                fitAllSignal={fitAllSignal}
              />
            </Suspense>
            {isMultiServer && hasData && filters.viewMode === 'circles' && (
              <ServerLegend variant="floating" servers={selectedServers} />
            )}
          </div>
          <aside className="bg-card/50 relative h-72 shrink-0 border-t md:h-auto md:w-[380px] md:border-t-0 md:border-l">
            <div
              ref={listRef}
              className="h-full"
              style={shown.length > 0 ? { visibility: 'hidden' } : undefined}
            >
              <LocationList
                locations={locations}
                bounds={view}
                isLoading={locationsLoading}
                hoveredKeys={hoveredKeys}
                onHover={hoverRow}
                onSelect={selectPlace}
                onShowAll={() => setFitAllSignal((n) => n + 1)}
              />
            </div>
            {selectedLocation && (
              <div className="absolute inset-0">
                <LocationPanel
                  key={locationKey(selectedLocation)}
                  location={selectedLocation}
                  historyFilters={{
                    ...locationHistoryFilters(selectedLocation),
                    serverIds: mapServerIds,
                    serverUserIds: mapServerUserIds,
                    mediaTypes: filters.mediaType ? [filters.mediaType] : undefined,
                    ...dateWindow,
                  }}
                  historyHref={`/history?${locationHistoryParams(selectedLocation, {
                    serverIds: mapServerIds,
                    serverUserIds: mapServerUserIds,
                    mediaType: filters.mediaType,
                    range: searchParams,
                  })}`}
                  onBack={closePanel}
                  onSelectPerson={selectPerson}
                  serverNames={isMultiServer ? serverNameMap : undefined}
                />
              </div>
            )}
            {selectedArea && (
              <div className="absolute inset-0">
                <AreaPanel
                  key={`area:${selectedKeys[0]}`}
                  places={selectedArea}
                  onBack={closePanel}
                  onSelectPlace={selectPlace}
                  onSelectPerson={selectPerson}
                />
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
