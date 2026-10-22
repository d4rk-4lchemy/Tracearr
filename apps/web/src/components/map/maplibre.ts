import { addProtocol, setWorkerUrl } from 'maplibre-gl';
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, Protocol } from 'pmtiles';
import { type Flavor, layers as flavorLayers, namedFlavor } from '@protomaps/basemaps';
import type { Feature, FeatureCollection } from 'geojson';
import type { LocationStats } from '@tracearr/shared';
import { API_BASE_URL } from '@/lib/api';
import { type Area, circleRadius } from './areas';
import { locationKey } from './locationKey';

setWorkerUrl(workerUrl);

const BASEMAP_URL = `${API_BASE_URL}/map/basemap`;

const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);
// One shared archive: the availability probe and the tile protocol reuse the
// same header and directory cache instead of fetching them twice.
const basemapArchive = new PMTiles(BASEMAP_URL);
protocol.add(basemapArchive);

let basemapCheck: Promise<boolean> | null = null;
let archiveMaxZoom: number | null = null;

export function checkBasemap(): Promise<boolean> {
  basemapCheck ??= basemapArchive
    .getHeader()
    .then((header) => {
      archiveMaxZoom = header.maxZoom;
      return true;
    })
    .catch(() => false);
  return basemapCheck;
}

// Vector tiles overzoom cleanly for a level or two; past that the coastlines
// turn to polygons. The floor keeps the heat to circle crossfade reachable on
// a shallow archive.
const MAX_OVERZOOM = 2;

export function mapMaxZoom(archiveZoom = archiveMaxZoom): number {
  return archiveZoom === null ? 14 : Math.max(HEAT_FADE.end, archiveZoom + MAX_OVERZOOM);
}

// The world is 512 px wide at zoom 0, so below this zoom the map would show it more than once.
export function worldFillZoom(width: number): number {
  return width > 512 ? Math.log2(width / 512) : 0;
}

let webglSupport: boolean | null = null;

// maplibre v6 needs webgl2 and fires its GPU error inside the Map constructor,
// before a caller can attach a listener, so probe before constructing one.
export function isWebglSupported(): boolean {
  if (webglSupport === null) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      webglSupport = gl !== null;
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

export const DEFAULT_SERVER_COLOR = 'hsl(142, 76%, 48%)';

export function hsl(h: number, s: number, l: number, a?: number): string {
  return a === undefined ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

export function colorToHue(color: string): number | null {
  const hslMatch = /^hsla?\(\s*(-?[\d.]+)/.exec(color);
  if (hslMatch?.[1] !== undefined) return ((Number(hslMatch[1]) % 360) + 360) % 360;
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!hexMatch?.[1]) return null;
  let hex = hexMatch[1];
  if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (((h * 60) % 360) + 360) % 360;
}

function heatColorRamp(hue: number): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    'rgba(0,0,0,0)',
    0.15,
    hsl(hue, 85, 31, 0.55),
    0.4,
    hsl(hue, 86, 42),
    0.6,
    hsl(hue, 80, 50),
    0.8,
    hsl(hue, 80, 60),
    0.95,
    hsl(hue, 80, 70),
    1,
    '#ffffff',
  ];
}

// Ground-anchored radius: kilometres converted to pixels per zoom, clamped to
// a band so the blob neither vanishes at world view nor swallows the screen.
const RADIUS_KM = 6;
const RADIUS_MIN_PX = 18;
const RADIUS_MAX_PX = 90;

function heatRadiusExpr(): ExpressionSpecification {
  const stops: number[] = [];
  for (let z = 0; z <= 14; z++) {
    const mpp = (156543.03392 * Math.cos((40 * Math.PI) / 180)) / 2 ** z;
    stops.push(z, Math.min(RADIUS_MAX_PX, Math.max(RADIUS_MIN_PX, (RADIUS_KM * 1000) / mpp)));
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
}

// Heatmap reads as density only above the data's city-level precision; past
// z8.5 it crossfades into per-location circles, with counts from z9.5.
export const HEAT_FADE = { start: 8.5, end: 10, circlesIn: 9.5 };

export function heatmapLayer(
  id: string,
  source: string,
  hue: number,
  filter?: ExpressionSpecification
): LayerSpecification {
  return {
    id,
    type: 'heatmap',
    source,
    ...(filter ? { filter } : {}),
    paint: {
      'heatmap-weight': ['get', 'w'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 3],
      'heatmap-radius': heatRadiusExpr(),
      'heatmap-color': heatColorRamp(hue),
      'heatmap-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        HEAT_FADE.start,
        1,
        HEAT_FADE.end,
        0,
      ],
    },
  };
}

export const HIGHLIGHTED: ExpressionSpecification = [
  'any',
  ['boolean', ['feature-state', 'hover'], false],
  ['boolean', ['feature-state', 'selected'], false],
];

/** Highlighting raises a circle's opacity to at least 0.75 and never lowers it. */
export function highlightOpacity(base: ExpressionSpecification | number): ExpressionSpecification {
  return ['case', HIGHLIGHTED, ['max', 0.75, base], base];
}

export function crossfadeCircleLayers(
  source: string,
  color: ExpressionSpecification | string,
  strokeColor: ExpressionSpecification | string,
  dark: boolean
): LayerSpecification[] {
  return [
    {
      id: 'pts-auto',
      type: 'circle',
      source,
      minzoom: HEAT_FADE.start,
      paint: {
        'circle-radius': ['get', 'r'],
        'circle-color': color,
        'circle-stroke-color': ['case', HIGHLIGHTED, '#ffffff', strokeColor],
        'circle-stroke-width': ['case', HIGHLIGHTED, 2, 1.5],
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          HEAT_FADE.start,
          0,
          HEAT_FADE.circlesIn,
          highlightOpacity(0.55),
        ],
        'circle-stroke-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          HEAT_FADE.start,
          0,
          HEAT_FADE.circlesIn,
          0.95,
        ],
      },
    },
    {
      id: 'pts-count',
      type: 'symbol',
      source,
      minzoom: HEAT_FADE.circlesIn,
      layout: {
        'text-field': ['to-string', ['get', 'count']],
        'text-font': ['Noto Sans Medium'],
        'text-size': 10.5,
      },
      paint: {
        'text-color': dark ? 'hsl(220, 15%, 88%)' : 'hsl(215, 20%, 18%)',
        'text-halo-color': dark ? 'hsla(240, 10%, 6%, 0.85)' : 'hsla(0, 0%, 100%, 0.85)',
        'text-halo-width': 1.2,
      },
    },
  ];
}

export interface LocationFeatureProps {
  key: string;
  w: number;
  r: number;
  count: number;
  serverId: string | null;
  members: number;
}

type PlacedLocation = LocationStats & { lat: number; lon: number };

export function hasMapPosition(l: LocationStats): l is PlacedLocation {
  return l.lat !== null && l.lon !== null;
}

/** Longitudes in [-180, 180]; west is past east when the view crosses the antimeridian. */
export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function inView(l: PlacedLocation, b: ViewBounds): boolean {
  const lonIn =
    b.west <= b.east ? l.lon >= b.west && l.lon <= b.east : l.lon >= b.west || l.lon <= b.east;
  return lonIn && l.lat >= b.south && l.lat <= b.north;
}

interface Slice {
  serverId: string | null;
  count: number;
}

function slices(l: PlacedLocation, perServer: boolean): Slice[] {
  if (perServer && l.servers?.length) {
    return l.servers.map((s) => ({ serverId: s.serverId || null, count: s.count }));
  }
  return [{ serverId: null, count: l.count }];
}

const sliceServer = (l: PlacedLocation, serverId: string | null) =>
  serverId ?? l.servers?.[0]?.serverId ?? null;

interface Group {
  key: string;
  members: PlacedLocation[];
}

function placed(locations: LocationStats[], areas: Area[] | undefined) {
  const valid = locations.filter(hasMapPosition);
  const maxCount = Math.max(...valid.map((l) => l.count), 1);
  const max = Math.log10(maxCount + 1);
  const byKey = new Map(valid.map((l) => [locationKey(l), l]));
  const groups: Group[] = areas
    ? areas.map((a) => ({ key: a.key, members: a.members.flatMap((k) => byKey.get(k) ?? []) }))
    : valid.map((l) => ({ key: locationKey(l), members: [l] }));
  return { maxCount, weight: (count: number) => Math.log10(count + 1) / max, groups };
}

/** Each server's total across the group, and the first member that has that server. */
function groupSlices(members: PlacedLocation[], perServer: boolean) {
  const sums = new Map<string | null, { count: number; carrier: PlacedLocation }>();
  for (const m of members) {
    for (const s of slices(m, perServer)) {
      const sum = sums.get(s.serverId);
      if (sum) sum.count += s.count;
      else sums.set(s.serverId, { count: s.count, carrier: m });
    }
  }
  return sums;
}

/** Sizes a group the way multi-server mode draws it: by its largest per-server sum. */
export function largestServerCount(locations: LocationStats[]): (memberKeys: string[]) => number {
  const byKey = new Map(locations.filter(hasMapPosition).map((l) => [locationKey(l), l]));
  return (keys) => {
    const sums = groupSlices(
      keys.flatMap((k) => byKey.get(k) ?? []),
      true
    );
    return Math.max(0, ...[...sums.values()].map((s) => s.count));
  };
}

function pointFeature(lon: number, lat: number, properties: LocationFeatureProps): Feature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties };
}

/** Without areas, one feature per place; with them, one per area (per server in both cases). */
export function locationsGeojson(
  locations: LocationStats[],
  perServer: boolean,
  areas?: Area[]
): FeatureCollection {
  const { maxCount, weight, groups } = placed(locations, areas);
  const features = groups.flatMap(({ key, members }) => {
    const anchor = members[0];
    if (!anchor) return [];
    return [...groupSlices(members, perServer)].map(([serverId, { count }]) =>
      pointFeature(anchor.lon, anchor.lat, {
        key,
        w: weight(count),
        r: circleRadius(count, maxCount, members.length > 1),
        count,
        serverId: sliceServer(anchor, serverId),
        members: members.length,
      })
    );
  });
  return { type: 'FeatureCollection', features };
}

export interface PlaceCircle {
  key: string;
  serverId: string | null;
  count: number;
  lon: number;
  lat: number;
  r: number;
  w: number;
}

/**
 * Where each place's circle (per server) sits under a grouping. Inside an area the first member
 * with a server carries the area's circle and the rest shrink to nothing at its anchor, so a
 * transition starts and ends on exactly what the settled grouping draws.
 */
export function placeCircles(
  locations: LocationStats[],
  perServer: boolean,
  areas: Area[]
): Map<string, PlaceCircle> {
  const { maxCount, weight, groups } = placed(locations, areas);
  const circles = new Map<string, PlaceCircle>();
  for (const { members } of groups) {
    const anchor = members[0];
    if (!anchor) continue;
    const sums = groupSlices(members, perServer);
    for (const m of members) {
      const key = locationKey(m);
      for (const s of slices(m, perServer)) {
        const sum = sums.get(s.serverId);
        circles.set(JSON.stringify([key, s.serverId]), {
          key,
          serverId: sliceServer(m, s.serverId),
          count: s.count,
          lon: anchor.lon,
          lat: anchor.lat,
          r: sum?.carrier === m ? circleRadius(sum.count, maxCount, members.length > 1) : 0,
          w: weight(sum?.count ?? s.count),
        });
      }
    }
  }
  return circles;
}

export function lerpCircles(
  from: Map<string, PlaceCircle>,
  to: Map<string, PlaceCircle>,
  t: number
): Map<string, PlaceCircle> {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return new Map(
    [...to].map(([id, c]) => {
      const f = from.get(id) ?? c;
      return [
        id,
        {
          ...c,
          lon: lerp(f.lon, c.lon),
          lat: lerp(f.lat, c.lat),
          r: lerp(f.r, c.r),
          w: lerp(f.w, c.w),
        },
      ];
    })
  );
}

export function circlesGeojson(circles: Map<string, PlaceCircle>): FeatureCollection {
  const features = [...circles.values()]
    .filter((c) => c.r > 0)
    .map(({ key, serverId, count, lon, lat, r, w }) =>
      pointFeature(lon, lat, { key, w, r, count, serverId, members: 1 })
    );
  return { type: 'FeatureCollection', features };
}

const LANDCOVER_KEYS = [
  'park_a',
  'park_b',
  'wood_a',
  'wood_b',
  'scrub_a',
  'scrub_b',
  'hospital',
  'industrial',
  'school',
  'zoo',
  'military',
  'pedestrian',
  'aerodrome',
  'sand',
  'beach',
  'glacier',
] as const;

function fill(keys: readonly (keyof Flavor)[], color: string): Partial<Flavor> {
  return Object.fromEntries(keys.map((k) => [k, color]));
}

// Colors sampled from the Carto dark_all and light_all raster tiles the map
// used before the MapLibre swap.
function flavorFor(dark: boolean): Flavor {
  if (dark) {
    return {
      ...namedFlavor('black'),
      ...fill(LANDCOVER_KEYS, '#0e0e0e'),
      ...fill(['other', 'minor_service', 'minor_a', 'minor_b', 'link'], '#1a1a1a'),
      ...fill(
        ['minor_service_casing', 'minor_casing', 'link_casing', 'major_casing_early'],
        '#090909'
      ),
      earth: '#090909',
      water: '#262626',
      buildings: '#111111',
      major: '#2a2b2b',
      highway: '#424343',
      boundaries: '#5c5e5e',
      city_label: '#a8b0b4',
      city_label_halo: '#111111',
      country_label: '#9d9d9d',
      ocean_label: '#6d7b81',
    };
  }
  return {
    ...namedFlavor('white'),
    ...fill(LANDCOVER_KEYS, '#f2f5f0'),
    ...fill(['other', 'minor_service', 'minor_a', 'minor_b', 'link', 'major'], '#fefefe'),
    ...fill(
      ['minor_service_casing', 'minor_casing', 'link_casing', 'major_casing_early'],
      '#e1e1e1'
    ),
    earth: '#fafaf8',
    water: '#d4dadc',
    buildings: '#e9e9e9',
    highway: '#ffffff',
    highway_casing_early: '#e1e1e1',
    city_label: '#697b89',
    country_label: '#8a99a4',
    state_label: '#97a4ae',
    ocean_label: '#abb6be',
  };
}

export interface BaseStyleOptions {
  dark: boolean;
  basemapOk: boolean;
  lang: string;
}

export function buildBaseStyle({ dark, basemapOk, lang }: BaseStyleOptions): StyleSpecification {
  const assets = new URL('basemaps/', document.baseURI).href;
  const flavorName = dark ? 'dark' : 'light';
  const style: StyleSpecification = {
    version: 8,
    glyphs: `${assets}fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}sprites/${flavorName}`,
    sources: {},
    layers: [
      {
        id: 'app-background',
        type: 'background',
        paint: { 'background-color': dark ? 'hsl(240, 10%, 4%)' : 'hsl(240, 5%, 96%)' },
      },
    ],
  };
  if (basemapOk) {
    style.sources.basemap = {
      type: 'vector',
      url: `pmtiles://${BASEMAP_URL}`,
      attribution:
        'Protomaps &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    };
    style.layers.push(
      ...flavorLayers('basemap', flavorFor(dark), { lang }).filter((l) => l.type !== 'background')
    );
  }
  return style;
}
