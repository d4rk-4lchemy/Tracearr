import { describe, expect, it } from 'vitest';
import { type Area, type AreaPoint, circleRadius, groupIntoAreas, mercatorAt } from './areas';

const flat = (lon: number, lat: number) => ({ x: lon, y: lat });

function point(key: string, lon: number, lat: number, count: number): AreaPoint {
  return { key, lon, lat, count };
}

function rank(a: AreaPoint, b: AreaPoint) {
  return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Scans every group so far for each group, pass after pass. */
function referenceGroups(points: AreaPoint[], project: typeof flat, maxCount: number): Area[] {
  const radius = (members: AreaPoint[], count: number) =>
    circleRadius(count, maxCount, members.length > 1);
  let groups = [...points].sort(rank).map((p) => ({
    anchor: p,
    ...project(p.lon, p.lat),
    members: [p],
    count: p.count,
    r: radius([p], p.count),
  }));
  for (;;) {
    const merged: typeof groups = [];
    for (const g of groups) {
      const into = merged.find((m) => Math.hypot(m.x - g.x, m.y - g.y) < m.r + g.r);
      if (into) {
        into.members.push(...g.members);
        into.count += g.count;
        into.r = radius(into.members, into.count);
      } else {
        merged.push(g);
      }
    }
    if (merged.length === groups.length) break;
    groups = merged;
  }
  return groups.map(({ anchor, members, count }) => {
    const keys = members.sort(rank).map((m) => m.key);
    return {
      key: keys.length > 1 ? `area:${anchor.key}` : anchor.key,
      members: keys,
      lon: anchor.lon,
      lat: anchor.lat,
      count,
    };
  });
}

describe('circleRadius', () => {
  it('draws the top place at 28 px, a tiny one at 5 px and caps an area at 40 px', () => {
    expect(circleRadius(412, 412, false)).toBe(28);
    expect(circleRadius(1, 412, false)).toBe(5);
    expect(circleRadius(100_000, 412, true)).toBe(40);
  });
});

describe('groupIntoAreas', () => {
  it('merges two overlapping circles into one area anchored at the larger place', () => {
    const big = point('big', 0, 0, 100);
    const small = point('small', 40, 0, 25);
    expect(groupIntoAreas([small, big], flat, 100)).toEqual([
      { key: 'area:big', members: ['big', 'small'], lon: 0, lat: 0, count: 125 },
    ]);
  });

  it('keeps places that do not touch apart under their own keys', () => {
    const areas = groupIntoAreas([point('a', 0, 0, 100), point('b', 100, 0, 25)], flat, 100);
    expect(areas.map((a) => [a.key, a.members])).toEqual([
      ['a', ['a']],
      ['b', ['b']],
    ]);
  });

  it('pulls in a third place that only the grown area circle reaches', () => {
    const a = point('a', 0, 0, 100);
    const b = point('b', 0, 40, 40);
    const c = point('c', 50, 0, 50);
    expect(groupIntoAreas([a, b, c], flat, 100)).toEqual([
      { key: 'area:a', members: ['a', 'c', 'b'], lon: 0, lat: 0, count: 190 },
    ]);
  });

  it('sizes circles from the sizing input when it is given', () => {
    const points = [point('a', 0, 0, 100), point('b', 45, 0, 100)];
    const perServer = (keys: string[]) => 50 * keys.length;
    expect(groupIntoAreas(points, flat, 100)).toHaveLength(1);
    expect(groupIntoAreas(points, flat, 100, perServer).map((a) => a.key)).toEqual(['a', 'b']);
  });

  it('always merges places on the same coordinate', () => {
    const areas = groupIntoAreas([point('x', 5, 5, 1), point('y', 5, 5, 1)], flat, 1000);
    expect(areas.map((a) => a.members)).toEqual([['x', 'y']]);
  });

  it('returns the same grouping for any input order', () => {
    const points = [
      point('a', 0, 0, 100),
      point('b', 0, 40, 40),
      point('c', 50, 0, 50),
      point('d', 300, 0, 10),
      point('e', 305, 0, 10),
      point('f', 600, 0, 3),
    ];
    const expected = groupIntoAreas(points, flat, 100);
    expect(groupIntoAreas([...points].reverse(), flat, 100)).toEqual(expected);
    expect(
      groupIntoAreas(
        [points[3]!, points[5]!, points[0]!, points[4]!, points[2]!, points[1]!],
        flat,
        100
      )
    ).toEqual(expected);
  });

  it('merges circles that straddle a grid cell boundary', () => {
    const areas = groupIntoAreas(
      [
        point('w', -2, 0, 1),
        point('e', 2, 0, 1),
        point('nw', 958, 958, 1),
        point('se', 962, 962, 1),
      ],
      flat,
      1
    );
    expect(areas.map((a) => a.members)).toEqual([
      ['e', 'w'],
      ['nw', 'se'],
    ]);
  });

  it('matches a scan of every group on thousands of random places', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const points = Array.from({ length: 3000 }, (_, i) =>
      point(`p${i}`, random() * 360 - 180, random() * 140 - 70, 1 + Math.floor(random() ** 3 * 400))
    );
    const maxCount = Math.max(...points.map((p) => p.count));
    for (const zoom of [2, 4, 6, 8]) {
      expect(groupIntoAreas(points, mercatorAt(zoom), maxCount)).toEqual(
        referenceGroups(points, mercatorAt(zoom), maxCount)
      );
    }
  });
});
