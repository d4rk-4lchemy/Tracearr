import {
  LayoutDashboard,
  Map,
  History,
  Users,
  Workflow,
  Settings,
  Activity,
  Library,
  LayoutGrid,
  Inbox,
} from 'lucide-react';
import type { UserRole } from '@tracearr/shared';
import type { NavKey } from '@tracearr/translations';
import { STAFF_ROLES } from '@tracearr/shared';

export interface NavItem {
  nameKey: NavKey;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresSeerr?: true;
  /** Absent means every role; present means only those. */
  roles?: UserRole[];
  badge?: 'pendingViolations';
  /** Draws a hairline above the item. */
  divider?: true;
}

export const navigation: NavItem[] = [
  { nameKey: 'dashboard', href: '/', icon: LayoutDashboard },
  { nameKey: 'map', href: '/map', icon: Map },
  { nameKey: 'history', href: '/history', icon: History },
  { nameKey: 'stats', href: '/stats', icon: Activity },
  { nameKey: 'library', href: '/library', icon: Library },
  { nameKey: 'mediaBrowse', href: '/media/browse', icon: LayoutGrid },
  { nameKey: 'requests', href: '/requests', icon: Inbox, requiresSeerr: true },
  { nameKey: 'users', href: '/users', icon: Users, roles: STAFF_ROLES, divider: true },
  {
    nameKey: 'automations',
    href: '/automations',
    icon: Workflow,
    roles: STAFF_ROLES,
    badge: 'pendingViolations',
  },
];

export const footerNavigation: NavItem[] = [
  { nameKey: 'settings', href: '/settings', icon: Settings, roles: STAFF_ROLES },
];

export function visibleItems(
  items: NavItem[],
  role: UserRole,
  seerrConfigured: boolean
): NavItem[] {
  return items.filter(
    (item) =>
      (seerrConfigured || item.requiresSeerr === undefined) &&
      (item.roles === undefined || item.roles.includes(role))
  );
}

/** Pages that live outside an item's own path but belong to it. */
const ALSO_ACTIVE_FOR: Record<string, (pathname: string) => boolean> = {
  '/automations': (pathname) => pathname === '/violations' || pathname.startsWith('/violations/'),
  '/media/browse': (pathname) => pathname.startsWith('/media/'),
};

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.href === '/') return pathname === '/';

  return (
    pathname === item.href ||
    pathname.startsWith(item.href + '/') ||
    ALSO_ACTIVE_FOR[item.href]?.(pathname) === true
  );
}
