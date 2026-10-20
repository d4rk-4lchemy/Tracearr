import { describe, it, expect } from 'vitest';
import {
  footerNavigation,
  isNavItemActive,
  navigation,
  visibleItems,
  type NavItem,
} from './nav-data';

const allItems: NavItem[] = [...navigation, ...footerNavigation];

function byHref(href: string): NavItem {
  const found = allItems.find((item) => item.href === href);
  if (!found) throw new Error(`no nav item for ${href}`);
  return found;
}

function activeHrefs(pathname: string): string[] {
  return allItems.filter((item) => isNavItemActive(pathname, item)).map((item) => item.href);
}

describe('navigation shape', () => {
  it('exposes nine destinations in the sidebar and settings in the footer', () => {
    expect(navigation.map((i) => i.href)).toEqual([
      '/',
      '/map',
      '/history',
      '/stats',
      '/library',
      '/media/browse',
      '/requests',
      '/users',
      '/automations',
    ]);
    expect(footerNavigation.map((i) => i.href)).toEqual(['/settings']);
  });

  it('exposes every destination exactly once', () => {
    const hrefs = allItems.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('gives each destination a distinct icon so an icon rail stays decodable', () => {
    const icons = allItems.map((item) => item.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('gives each destination a distinct label key', () => {
    const keys = allItems.map((item) => item.nameKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isNavItemActive', () => {
  it('matches the dashboard only on an exact root path', () => {
    const dashboard = byHref('/');
    expect(isNavItemActive('/', dashboard)).toBe(true);
    expect(isNavItemActive('/users', dashboard)).toBe(false);
  });

  it('matches an entry and its descendants', () => {
    const users = byHref('/users');
    expect(isNavItemActive('/users', users)).toBe(true);
    expect(isNavItemActive('/users/abc', users)).toBe(true);
    expect(isNavItemActive('/users-report', users)).toBe(false);
  });

  it('lights automations for a violation page and browse for a media detail page', () => {
    expect(isNavItemActive('/violations', byHref('/automations'))).toBe(true);
    expect(isNavItemActive('/violations/abc', byHref('/automations'))).toBe(true);
    expect(isNavItemActive('/media/abc', byHref('/media/browse'))).toBe(true);
    expect(isNavItemActive('/media/abc', byHref('/library'))).toBe(false);
  });

  it('lights library for every library tab and stats for every stats tab', () => {
    expect(activeHrefs('/library/genres')).toEqual(['/library']);
    expect(activeHrefs('/library/storage')).toEqual(['/library']);
    expect(activeHrefs('/stats/people')).toEqual(['/stats']);
  });

  it('lights nothing on bare /media, which is not a destination', () => {
    expect(activeHrefs('/media')).toEqual([]);
  });

  it('never lights up two destinations at once', () => {
    const paths = [
      '/',
      '/map',
      '/history',
      '/stats',
      '/stats/activity',
      '/stats/people',
      '/stats/bandwidth',
      '/library',
      '/library/genres',
      '/library/quality',
      '/library/storage',
      '/media/browse',
      '/media/genres',
      '/media/abc',
      '/requests',
      '/users',
      '/users/abc',
      '/automations',
      '/violations',
      '/violations/abc',
      '/settings',
    ];

    for (const path of paths) {
      expect(activeHrefs(path), `${path} should mark exactly one entry`).toHaveLength(1);
    }
  });
});

describe('visibleItems', () => {
  const hrefsFor = (role: Parameters<typeof visibleItems>[1], seerr = true) =>
    visibleItems(allItems, role, seerr).map((item) => item.href);

  it('gives the owner and admins every destination', () => {
    const all = allItems.map((item) => item.href);

    expect(hrefsFor('owner')).toEqual(all);
    expect(hrefsFor('admin')).toEqual(all);
  });

  it('shows a member dashboard, map, history, stats, library, browse and requests only', () => {
    expect(hrefsFor('member')).toEqual([
      '/',
      '/map',
      '/history',
      '/stats',
      '/library',
      '/media/browse',
      '/requests',
    ]);
  });

  it('still hides Requests until a Seerr is linked', () => {
    expect(hrefsFor('member', false)).not.toContain('/requests');
  });
});
