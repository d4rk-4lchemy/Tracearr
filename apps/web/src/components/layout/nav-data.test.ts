import { describe, it, expect } from 'vitest';
import { isNavItemActive, navigation, visibleItems, type NavItem } from './nav-data';

const allItems: NavItem[] = navigation.flatMap((section) => section.items);

function byHref(href: string): NavItem {
  const found = allItems.find((item) => item.href === href);
  if (!found) throw new Error(`no nav item for ${href}`);
  return found;
}

function activeHrefs(pathname: string): string[] {
  return allItems.filter((item) => isNavItemActive(pathname, item)).map((item) => item.href);
}

describe('navigation shape', () => {
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

  it('keeps /media off while a deeper /media route is open', () => {
    expect(activeHrefs('/media')).toEqual(['/media']);
    expect(activeHrefs('/media/browse')).toEqual(['/media/browse']);
    expect(activeHrefs('/media/genres')).toEqual(['/media/genres']);
  });

  it('matches descendants of an entry nothing sits below', () => {
    expect(activeHrefs('/media/browse/123')).toEqual(['/media/browse']);
  });

  it('never lights up two destinations at once', () => {
    const paths = [
      '/',
      '/map',
      '/history',
      '/stats/activity',
      '/stats/users',
      '/stats/devices',
      '/stats/bandwidth',
      '/media',
      '/media/browse',
      '/media/genres',
      '/library/quality',
      '/library/storage',
      '/library/watch',
      '/users',
      '/automations',
      '/violations',
      '/settings',
    ];

    for (const path of paths) {
      expect(activeHrefs(path), `${path} should mark exactly one entry`).toHaveLength(1);
    }
  });

  it('separates the two user destinations', () => {
    expect(activeHrefs('/stats/users')).toEqual(['/stats/users']);
    expect(activeHrefs('/users')).toEqual(['/users']);
  });
});

describe('visibleItems', () => {
  const hrefsFor = (role: Parameters<typeof visibleItems>[1], seerr = true) =>
    navigation.flatMap((section) => visibleItems(section, role, seerr)).map((item) => item.href);

  it('gives the owner and admins every destination', () => {
    const all = allItems.map((item) => item.href);

    expect(hrefsFor('owner')).toEqual(all);
    expect(hrefsFor('admin')).toEqual(all);
  });

  it('keeps management pages away from members', () => {
    const member = hrefsFor('member');

    for (const href of [
      '/users',
      '/automations',
      '/settings',
      '/stats/users',
      '/stats/devices',
      '/stats/bandwidth',
      '/library/quality',
      '/library/storage',
      '/library/watch',
      '/violations',
    ]) {
      expect(member).not.toContain(href);
    }
  });

  it('leaves members the pages that show their own activity', () => {
    const member = hrefsFor('member');

    for (const href of ['/', '/map', '/history', '/media', '/requests']) {
      expect(member).toContain(href);
    }
  });

  it('keeps By User and Violations to the owner and admins, and has no Your Stats entry', () => {
    expect(hrefsFor('member')).not.toContain('/stats/users');
    expect(hrefsFor('owner')).toContain('/stats/users');
    expect(hrefsFor('owner')).toContain('/violations');
    expect(hrefsFor('owner')).not.toContain('/stats/me');
  });

  it('still hides Requests until a Seerr is linked', () => {
    expect(hrefsFor('member', false)).not.toContain('/requests');
  });
});
