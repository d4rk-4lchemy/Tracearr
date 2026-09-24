import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { navigation } from '@/components/layout/nav-data';
import { useActiveSessions } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';
import { useSocket } from '@/hooks/useSocket';
import type { NavKey } from '@tracearr/translations';

const APP_NAME = 'Tracearr';

/**
 * Live stream count, shared by both title writers. A module store rather than
 * context: the count is set from the authenticated shell but read by hooks that
 * also run above it, and every reader has to re-render when it moves or the tab
 * keeps a number that has already changed.
 */
let streamCount = 0;
const countListeners = new Set<() => void>();

function setStreamCount(next: number): void {
  if (next === streamCount) return;
  streamCount = next;
  for (const listener of countListeners) listener();
}

function subscribeToCount(listener: () => void): () => void {
  countListeners.add(listener);
  return () => {
    countListeners.delete(listener);
  };
}

function useStreamCount(): number {
  return useSyncExternalStore(
    subscribeToCount,
    () => streamCount,
    () => 0
  );
}

/** `(3) Users | Tracearr` while streams are running, `Users | Tracearr` otherwise */
function formatTitle(pageName: string, count: number): string {
  return count > 0 ? `(${count}) ${pageName} | ${APP_NAME}` : `${pageName} | ${APP_NAME}`;
}

/**
 * Feeds the tab title the number of streams now playing, so a backgrounded tab
 * shows it without being switched to. Mounted by the authenticated shell: the
 * count resets when that unmounts, which keeps it off the login screen.
 */
export function useStreamCountTitle(): void {
  const { selectedServerIds } = useServer();
  const { isConnected } = useSocket();
  const { data } = useActiveSessions(selectedServerIds, isConnected);
  const count = data?.length ?? 0;

  useEffect(() => {
    setStreamCount(count);
    return () => setStreamCount(0);
  }, [count]);
}

/**
 * Build a flat map of href -> nameKey from navigation data
 */
function buildRouteMap(): Map<string, NavKey> {
  return new Map(
    navigation.flatMap((section) => section.items.map((item) => [item.href, item.nameKey] as const))
  );
}

const routeMap = buildRouteMap();

/** What a page called itself, by path, so the route derivation defers to it. */
const pageTitles = new Map<string, string>();

/**
 * Hook to automatically update the document title based on the current route.
 * Titles are derived from nav-data.ts for consistency.
 */
export function useDocumentTitle() {
  const location = useLocation();
  const { t } = useTranslation(['nav', 'pages']);
  const count = useStreamCount();

  useEffect(() => {
    const pathname = location.pathname;

    // A page that knows its own name has already said so, whether or not its effect ran first.
    const own = pageTitles.get(pathname);
    if (own !== undefined) {
      document.title = formatTitle(own, count);
      return;
    }

    // Check for exact match in navigation
    const navKey = routeMap.get(pathname);
    if (navKey) {
      document.title = formatTitle(t(navKey), count);
      return;
    }

    // Handle dynamic routes and routes not in nav
    if (pathname.startsWith('/users/')) {
      document.title = formatTitle(t('pages:userDetail.title'), count);
      return;
    }

    if (pathname.startsWith('/media/')) {
      document.title = formatTitle(t('pages:media.detail.title'), count);
      return;
    }

    if (pathname === '/automations/new') {
      document.title = formatTitle(t('pages:automations.createAutomation'), count);
      return;
    }

    if (pathname.startsWith('/automations/') && pathname.endsWith('/edit')) {
      document.title = formatTitle(t('pages:automations.editAutomation'), count);
      return;
    }

    // The row's own name lands via usePageTitle once it loads; this holds the tab until then.
    if (pathname.startsWith('/automations/')) {
      document.title = formatTitle(t('pages:automations.detail.title'), count);
      return;
    }

    if (pathname.startsWith('/settings')) {
      document.title = formatTitle(t('settings'), count);
      return;
    }

    // Fallback: derive title from pathname
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) {
      const title = lastSegment
        .split('-')
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      document.title = formatTitle(title, count);
      return;
    }

    document.title = APP_NAME;
  }, [location.pathname, t, count]);
}

/**
 * A page that knows its own name says so, over whatever the route derived. The
 * previous title comes back on unmount, so a route with nothing to say is unaffected.
 */
export function usePageTitle(title: string | undefined) {
  const { pathname } = useLocation();
  const count = useStreamCount();

  useEffect(() => {
    if (title === undefined || title === '') return;
    const previous = document.title;
    pageTitles.set(pathname, title);
    document.title = formatTitle(title, count);
    return () => {
      pageTitles.delete(pathname);
      document.title = previous;
    };
  }, [pathname, title, count]);
}
