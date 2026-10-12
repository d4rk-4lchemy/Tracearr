import {
  LayoutDashboard,
  Map,
  History,
  Users,
  Workflow,
  AlertTriangle,
  Settings,
  UserCircle,
  Smartphone,
  Activity,
  ArrowUpDown,
  Library,
  Sparkles,
  HardDrive,
  Eye,
  LayoutGrid,
  Tags,
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
}

export interface NavSection {
  labelKey: NavKey;
  items: NavItem[];
}

/**
 * Static sections rather than collapsibles: a collapsible's children live in
 * SidebarMenuSub, which is `group-data-[collapsible=icon]:hidden`, so an icon
 * rail would drop every child destination.
 */
export const navigation: NavSection[] = [
  {
    labelKey: 'monitor',
    items: [
      { nameKey: 'dashboard', href: '/', icon: LayoutDashboard },
      { nameKey: 'map', href: '/map', icon: Map },
      { nameKey: 'history', href: '/history', icon: History },
    ],
  },
  {
    labelKey: 'stats',
    items: [
      { nameKey: 'activity', href: '/stats/activity', icon: Activity },
      { nameKey: 'userStats', href: '/stats/users', icon: UserCircle, roles: STAFF_ROLES },
      { nameKey: 'devices', href: '/stats/devices', icon: Smartphone, roles: STAFF_ROLES },
      { nameKey: 'bandwidth', href: '/stats/bandwidth', icon: ArrowUpDown, roles: STAFF_ROLES },
    ],
  },
  {
    labelKey: 'media',
    items: [
      { nameKey: 'overview', href: '/media', icon: Library },
      { nameKey: 'mediaBrowse', href: '/media/browse', icon: LayoutGrid },
      { nameKey: 'mediaGenres', href: '/media/genres', icon: Tags },
      { nameKey: 'quality', href: '/library/quality', icon: Sparkles, roles: STAFF_ROLES },
      { nameKey: 'storage', href: '/library/storage', icon: HardDrive, roles: STAFF_ROLES },
      { nameKey: 'watch', href: '/library/watch', icon: Eye, roles: STAFF_ROLES },
      { nameKey: 'requests', href: '/requests', icon: Inbox, requiresSeerr: true },
    ],
  },
  {
    labelKey: 'manage',
    items: [
      { nameKey: 'users', href: '/users', icon: Users, roles: STAFF_ROLES },
      { nameKey: 'automations', href: '/automations', icon: Workflow, roles: STAFF_ROLES },
      { nameKey: 'violations', href: '/violations', icon: AlertTriangle, roles: STAFF_ROLES },
      { nameKey: 'settings', href: '/settings', icon: Settings, roles: STAFF_ROLES },
    ],
  },
];

export function visibleItems(
  section: NavSection,
  role: UserRole,
  seerrConfigured: boolean
): NavItem[] {
  return section.items.filter(
    (item) =>
      (seerrConfigured || item.requiresSeerr === undefined) &&
      (item.roles === undefined || item.roles.includes(role))
  );
}

const allItems: NavItem[] = navigation.flatMap((section) => section.items);

/**
 * An entry whose href prefixes another entry's (e.g. /media beside
 * /media/browse) matches exactly, so the parent doesn't light up alongside its
 * own descendants. Checked against every destination, not just section peers,
 * because sections no longer scope the comparison.
 */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.href === '/') return pathname === '/';

  const prefixesAnother = allItems.some(
    (other) => other !== item && other.href.startsWith(item.href + '/')
  );
  if (prefixesAnother) return pathname === item.href;

  return pathname === item.href || pathname.startsWith(item.href + '/');
}
