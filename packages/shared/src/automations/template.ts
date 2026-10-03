/**
 * A small Liquid subset for notification text: `{{ name }}`, `{{ name | default: "x" }}`
 * and `{% if name %}...{% else %}...{% endif %}`. It imports nothing from Tracearr; the
 * variable lookup and the escaping arrive as arguments.
 */

export type TemplateNode =
  | { kind: 'text'; value: string }
  | { kind: 'output'; name: string; fallback?: string }
  | { kind: 'if'; name: string; then: TemplateNode[]; else: TemplateNode[] };

type IfNode = Extract<TemplateNode, { kind: 'if' }>;

export const TEMPLATE_ERROR_CODES = [
  'unclosed',
  'invalidOutput',
  'invalidTag',
  'unexpectedElse',
  'unexpectedEndif',
  'missingEndif',
] as const;
export type TemplateErrorCode = (typeof TEMPLATE_ERROR_CODES)[number];

export interface TemplateError {
  code: TemplateErrorCode;
  line: number;
  column: number;
}

export type ParseResult = { ok: true; nodes: TemplateNode[] } | { ok: false; error: TemplateError };

export interface TextLimit {
  max: number;
  unit: 'chars' | 'bytes';
}

const NAME = '[A-Za-z]\\w*(?:\\.[A-Za-z_]\\w*)*';
const OUTPUT = new RegExp(`^(${NAME})(?:\\s*\\|\\s*default:\\s*(?:"([^"]*)"|'([^']*)'))?$`);
const IF_TAG = new RegExp(`^if\\s+(${NAME})$`);
const TOKEN = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g;
const OPENER = /\{\{|\{%/;
/** The only syntax text saved before the grammar existed was checked against. */
const LEGACY_VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g;

type Segment =
  | { kind: 'text'; value: string; at: number }
  | { kind: 'output'; body: string; at: number }
  | { kind: 'tag'; body: string; at: number };

function position(text: string, at: number): { line: number; column: number } {
  const before = text.slice(0, at);
  return { line: before.split('\n').length, column: at - before.lastIndexOf('\n') };
}

function tokenize(text: string): Segment[] | TemplateError {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) segments.push({ kind: 'text', value: text.slice(last, at), at: last });
    segments.push(
      match[1] !== undefined
        ? { kind: 'output', body: match[1], at }
        : { kind: 'tag', body: match[2] ?? '', at }
    );
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last), at: last });

  for (const segment of segments) {
    if (segment.kind !== 'text') continue;
    const open = segment.value.search(OPENER);
    if (open !== -1) return { code: 'unclosed', ...position(text, segment.at + open) };
  }
  return segments;
}

/** A tag alone on its line, so the line disappears with it instead of leaving a gap. */
function isStandalone(segments: readonly Segment[], i: number): boolean {
  const prev = segments[i - 1];
  const next = segments[i + 1];
  const before =
    prev === undefined ||
    (prev.kind === 'text' &&
      (/\n[ \t]*$/.test(prev.value) || (i === 1 && /^[ \t]*$/.test(prev.value))));
  const after =
    next === undefined ||
    (next.kind === 'text' &&
      (/^[ \t]*\r?\n/.test(next.value) ||
        (i === segments.length - 2 && /^[ \t]*$/.test(next.value))));
  return before && after;
}

export function parseTemplate(text: string): ParseResult {
  const segments = tokenize(text);
  if (!Array.isArray(segments)) return { ok: false, error: segments };

  const texts = segments.map((segment) => (segment.kind === 'text' ? segment.value : ''));
  const standalone = segments.flatMap((segment, i) =>
    segment.kind === 'tag' && isStandalone(segments, i) ? [i] : []
  );
  for (const i of standalone) {
    if (segments[i - 1]?.kind === 'text')
      texts[i - 1] = (texts[i - 1] ?? '').replace(/[ \t]*$/, '');
    if (segments[i + 1]?.kind === 'text') {
      texts[i + 1] = (texts[i + 1] ?? '').replace(/^[ \t]*\r?\n?/, '');
    }
  }

  const root: TemplateNode[] = [];
  const stack: { node: IfNode; inElse: boolean; at: number }[] = [];
  const target = (): TemplateNode[] => {
    const top = stack[stack.length - 1];
    if (top === undefined) return root;
    return top.inElse ? top.node.else : top.node.then;
  };

  for (const [i, segment] of segments.entries()) {
    const fail = (code: TemplateErrorCode): ParseResult => ({
      ok: false,
      error: { code, ...position(text, segment.at) },
    });

    if (segment.kind === 'text') {
      const value = texts[i] ?? '';
      if (value !== '') target().push({ kind: 'text', value });
      continue;
    }

    const body = segment.body.trim();
    if (segment.kind === 'output') {
      const match = OUTPUT.exec(body);
      const name = match?.[1];
      if (name === undefined) return fail('invalidOutput');
      const fallback = match?.[2] ?? match?.[3];
      target().push(
        fallback === undefined ? { kind: 'output', name } : { kind: 'output', name, fallback }
      );
      continue;
    }

    if (body === 'else') {
      const top = stack[stack.length - 1];
      if (top === undefined || top.inElse) return fail('unexpectedElse');
      top.inElse = true;
      continue;
    }
    if (body === 'endif') {
      if (stack.pop() === undefined) return fail('unexpectedEndif');
      continue;
    }
    const name = IF_TAG.exec(body)?.[1];
    if (name === undefined) return fail('invalidTag');
    const node: IfNode = { kind: 'if', name, then: [], else: [] };
    target().push(node);
    stack.push({ node, inElse: false, at: segment.at });
  }

  const open = stack[stack.length - 1];
  if (open !== undefined) {
    return { ok: false, error: { code: 'missingEndif', ...position(text, open.at) } };
  }
  return { ok: true, nodes: root };
}

export function templateVariables(nodes: readonly TemplateNode[]): string[] {
  const names = new Set<string>();
  const walk = (list: readonly TemplateNode[]) => {
    for (const node of list) {
      if (node.kind === 'text') continue;
      names.add(node.name);
      if (node.kind === 'if') {
        walk(node.then);
        walk(node.else);
      }
    }
  };
  walk(nodes);
  return [...names];
}

/** A plain-object lookup answers prototype names with functions; those render as nothing. */
function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Template text is copied as written; every inserted value, default text included, is escaped. */
export function renderTemplate(
  nodes: readonly TemplateNode[],
  lookup: (name: string) => string | undefined,
  escape: (value: string) => string
): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.value;
      continue;
    }
    const value = stringOrEmpty(lookup(node.name));
    const empty = value.trim() === '';
    if (node.kind === 'output') {
      out += escape(empty && node.fallback !== undefined ? node.fallback : value);
    } else {
      out += renderTemplate(empty ? node.else : node.then, lookup, escape);
    }
  }
  return out;
}

/**
 * What the server sends. Text the grammar rejects was saved before it existed, or is a
 * newsletter subject nobody validated as a template, so it renders the way it always did.
 */
export function renderText(
  text: string,
  lookup: (name: string) => string | undefined,
  escape: (value: string) => string
): string {
  const parsed = parseTemplate(text);
  if (parsed.ok) return renderTemplate(parsed.nodes, lookup, escape);
  return text.replace(LEGACY_VARIABLE, (_match, name: string) =>
    escape(stringOrEmpty(lookup(name)))
  );
}

const ELLIPSIS = '…';
const encoder = new TextEncoder();

export function textSize(text: string, unit: TextLimit['unit']): number {
  return unit === 'bytes' ? encoder.encode(text).length : Array.from(text).length;
}

export function fitText(text: string, limit: TextLimit): string {
  if (textSize(text, limit.unit) <= limit.max) return text;
  const budget = limit.max - textSize(ELLIPSIS, limit.unit);
  let kept = '';
  let used = 0;
  for (const char of text) {
    const size = textSize(char, limit.unit);
    if (used + size > budget) break;
    kept += char;
    used += size;
  }
  // An odd run of trailing backslashes ends in half an escape.
  const slashes = /\\+$/.exec(kept)?.[0].length ?? 0;
  if (slashes % 2 === 1) kept = kept.slice(0, -1);
  return kept + ELLIPSIS;
}
