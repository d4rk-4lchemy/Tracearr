import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useServer } from '@/hooks/useServer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MediaServerIcon } from '@/components/icons/MediaServerIcon';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const DASHBOARD_SELECTED_SERVERS_KEY = 'tracearr_dashboard_selected_servers';
const LAST_SINGLE_SERVER_KEY = 'tracearr_last_single_server';

export function ServerSelector() {
  const location = useLocation();
  const isMultiSelectRoute =
    location.pathname === '/' ||
    location.pathname.startsWith('/map') ||
    location.pathname.startsWith('/history');
  const {
    servers,
    selectedServerIds,
    isAllServersSelected,
    toggleServer,
    setSelectedServers,
    selectAllServers,
    deselectAllExcept,
    isLoading,
    isFetching,
  } = useServer();

  // Preserve multi-select on Dashboard/Map/History while keeping other pages single-server only.
  const prevPathname = useRef(location.pathname);
  const shouldRestoreMultiSelection = useRef(isMultiSelectRoute);
  useEffect(() => {
    const wasMultiRoute =
      prevPathname.current === '/' ||
      prevPathname.current.startsWith('/map') ||
      prevPathname.current.startsWith('/history');
    const isNowMultiRoute =
      location.pathname === '/' ||
      location.pathname.startsWith('/map') ||
      location.pathname.startsWith('/history');
    prevPathname.current = location.pathname;

    if (wasMultiRoute && !isNowMultiRoute) {
      if (selectedServerIds.length > 1) {
        localStorage.setItem(DASHBOARD_SELECTED_SERVERS_KEY, JSON.stringify(selectedServerIds));

        const rememberedSingle = localStorage.getItem(LAST_SINGLE_SERVER_KEY);
        const fallbackSingle = selectedServerIds.find((id) => id === rememberedSingle);
        deselectAllExcept(fallbackSingle ?? selectedServerIds[0]!);
      }
      return;
    }

    if (!wasMultiRoute && isNowMultiRoute) {
      shouldRestoreMultiSelection.current = true;
    }

    if (isNowMultiRoute && shouldRestoreMultiSelection.current) {
      if (servers.length === 0) return;
      try {
        const stored = localStorage.getItem(DASHBOARD_SELECTED_SERVERS_KEY);
        if (!stored) {
          shouldRestoreMultiSelection.current = false;
          return;
        }
        const parsed = JSON.parse(stored) as string[];
        if (!Array.isArray(parsed) || parsed.length < 2) {
          shouldRestoreMultiSelection.current = false;
          return;
        }
        const validIds = parsed.filter((id) => servers.some((s) => s.id === id));
        if (validIds.length < 2) {
          shouldRestoreMultiSelection.current = false;
          return;
        }
        const isSameSelection =
          validIds.length === selectedServerIds.length &&
          validIds.every((id, idx) => id === selectedServerIds[idx]);
        if (!isSameSelection) {
          setSelectedServers(validIds);
        }
        shouldRestoreMultiSelection.current = false;
      } catch {
        // Ignore invalid localStorage payload
        shouldRestoreMultiSelection.current = false;
      }
    }
  }, [location.pathname, selectedServerIds, servers, deselectAllExcept, setSelectedServers]);

  // Remember non-multi-route single selection as preferred fallback.
  useEffect(() => {
    if (isMultiSelectRoute || selectedServerIds.length !== 1) return;
    localStorage.setItem(LAST_SINGLE_SERVER_KEY, selectedServerIds[0]!);
  }, [isMultiSelectRoute, selectedServerIds]);

  // Show skeleton while loading initially or refetching with no cached data
  if (isLoading || (servers.length === 0 && isFetching)) {
    return (
      <div className="px-4 py-2">
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  // No servers available
  if (servers.length === 0) {
    return null;
  }

  // Only one server — show static label
  if (servers.length === 1) {
    const server = servers[0]!;
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-4 py-2 text-sm">
        <MediaServerIcon type={server.type} className="h-4 w-4" />
        <span className="truncate font-medium">{server.name}</span>
      </div>
    );
  }

  // Resolve single selected server for trigger display
  const singleSelected =
    selectedServerIds.length === 1 ? servers.find((s) => s.id === selectedServerIds[0]) : undefined;

  // Build trigger label
  const triggerLabel = isAllServersSelected
    ? 'All servers'
    : singleSelected
      ? singleSelected.name
      : `${selectedServerIds.length} of ${servers.length} servers`;

  return (
    <div className="px-4 py-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="h-9 w-full justify-between border-l-2 text-sm font-normal"
            style={{ borderLeftColor: singleSelected?.color ?? 'transparent' }}
          >
            <span className="flex items-center gap-2 truncate">
              {singleSelected && (
                <MediaServerIcon type={singleSelected.type} className="h-4 w-4 shrink-0" />
              )}
              {triggerLabel}
            </span>
            <ChevronsUpDown className="text-muted-foreground ml-2 h-4 w-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          {/* Select All toggle — on multi-select routes */}
          {isMultiSelectRoute && (
            <>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground w-full px-2 py-1.5 text-left text-xs"
                onClick={() => {
                  if (isAllServersSelected) {
                    // Deselect all except first
                    toggleServer(servers[0]!.id);
                    for (const s of servers.slice(1)) {
                      if (selectedServerIds.includes(s.id)) {
                        toggleServer(s.id);
                      }
                    }
                  } else {
                    selectAllServers();
                  }
                }}
              >
                {isAllServersSelected ? 'Deselect all' : 'Select all'}
              </button>
              <div className="my-1 border-t" />
            </>
          )}
          {/* Server list */}
          {servers.map((server) => {
            const isSelected = selectedServerIds.includes(server.id);
            return isMultiSelectRoute ? (
              <label
                key={server.id}
                className="hover:bg-accent flex cursor-pointer items-center gap-2.5 rounded-sm border-l-2 px-2 py-1.5"
                style={{ borderLeftColor: server.color ?? 'transparent' }}
              >
                <Checkbox checked={isSelected} onCheckedChange={() => toggleServer(server.id)} />
                <MediaServerIcon type={server.type} className="h-4 w-4 shrink-0" />
                <span className="truncate text-sm">{server.name}</span>
              </label>
            ) : (
              <button
                key={server.id}
                type="button"
                className={cn(
                  'hover:bg-accent flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-l-2 px-2 py-1.5',
                  isSelected && 'bg-accent'
                )}
                style={{ borderLeftColor: server.color ?? 'transparent' }}
                onClick={() => deselectAllExcept(server.id)}
              >
                <MediaServerIcon type={server.type} className="h-4 w-4 shrink-0" />
                <span className="truncate text-sm">{server.name}</span>
                {isSelected && <Check className="text-muted-foreground ml-auto h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
}
