import { describe, expect, it } from 'vitest';
import {
  fitText,
  parseTemplate,
  renderTemplate,
  renderText,
  templateVariables,
  type TemplateNode,
} from '../template.js';

const values: Record<string, string> = {
  'user.username': 'alex',
  'device.location': 'Denver, US',
  'device.platform': '',
  'session.mediaTitle': 'The Bear',
};
const lookup = (name: string) => values[name];
const same = (value: string) => value;
const bracket = (value: string) => `[${value}]`;

function nodes(text: string): TemplateNode[] {
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return parsed.nodes;
}

const render = (text: string, escape = same) => renderTemplate(nodes(text), lookup, escape);

describe('parseTemplate and renderTemplate', () => {
  it('prints variables with or without inner spaces', () => {
    expect(render('{{user.username}} and {{ user.username }}')).toBe('alex and alex');
  });

  it('prints an unknown name as nothing', () => {
    expect(render('a{{ nope }}b')).toBe('ab');
  });

  it('uses the default when the value is empty or whitespace', () => {
    expect(render('{{ device.platform | default: "unknown" }}')).toBe('unknown');
    expect(render("{{ device.platform | default: 'n/a' }}")).toBe('n/a');
    expect(render('{{ user.username | default: "x" }}')).toBe('alex');
  });

  it('keeps the if branch for a present value and the else branch otherwise', () => {
    expect(render('{% if device.location %}from {{ device.location }}{% endif %}')).toBe(
      'from Denver, US'
    );
    expect(render('{% if device.platform %}yes{% else %}no{% endif %}')).toBe('no');
  });

  it('nests if blocks', () => {
    expect(
      render('{% if user.username %}{% if device.platform %}a{% else %}b{% endif %}{% endif %}')
    ).toBe('b');
  });

  it('drops a line holding only a block tag, newline included', () => {
    expect(render('line one\n{% if device.location %}\nfrom here\n{% endif %}\nend')).toBe(
      'line one\nfrom here\nend'
    );
    expect(render('  {% if device.platform %}  \nhidden\n{% endif %}\nshown')).toBe('shown');
  });

  it('drops tag-only lines ending in CRLF without leaving a carriage return', () => {
    expect(render('a\r\n{% if device.location %}\r\nb\r\n{% endif %}\r\nc')).toBe('a\r\nb\r\nc');
  });

  it('keeps a tag that shares its line with text', () => {
    expect(render('x {% if device.location %}y{% endif %} z')).toBe('x y z');
  });

  it('escapes inserted values and default text but never template text', () => {
    expect(render('*{{ user.username }}* {{ device.platform | default: "d" }}', bracket)).toBe(
      '*[alex]* [d]'
    );
  });

  it('prints a value containing template syntax literally', () => {
    const risky = (name: string) => (name === 'user.username' ? '{{ x }} {% if a %}' : undefined);
    expect(renderTemplate(nodes('{{ user.username }}'), risky, same)).toBe('{{ x }} {% if a %}');
  });

  it('lists every variable name once, including if conditions', () => {
    expect(
      templateVariables(
        nodes('{{ a.b }}{% if c %}{{ a.b }}{% else %}{{ d | default: "x" }}{% endif %}')
      )
    ).toEqual(['a.b', 'c', 'd']);
  });
});

describe('parse errors', () => {
  const error = (text: string) => {
    const parsed = parseTemplate(text);
    return parsed.ok ? null : parsed.error;
  };

  it('names the code and a 1-based line and column', () => {
    expect(error('ok\n  {{ user.username')).toEqual({ code: 'unclosed', line: 2, column: 3 });
    expect(error('{{ a b }}')).toEqual({ code: 'invalidOutput', line: 1, column: 1 });
    expect(error('{{ a | upcase }}')).toMatchObject({ code: 'invalidOutput' });
    expect(error('{{ 1abc }}')).toMatchObject({ code: 'invalidOutput' });
    expect(error('{% for x in y %}')).toMatchObject({ code: 'invalidTag' });
    expect(error('{% else %}')).toMatchObject({ code: 'unexpectedElse' });
    expect(error('{% if a %}{% else %}{% else %}{% endif %}')).toMatchObject({
      code: 'unexpectedElse',
    });
    expect(error('{% endif %}')).toMatchObject({ code: 'unexpectedEndif' });
    expect(error('x\n{% if a %}y')).toEqual({ code: 'missingEndif', line: 2, column: 1 });
    expect(error('{% if a')).toMatchObject({ code: 'unclosed' });
  });
});

describe('renderText', () => {
  it('renders valid templates through the grammar', () => {
    expect(
      renderText('{% if user.username %}hi {{ user.username }}{% endif %}', lookup, same)
    ).toBe('hi alex');
  });

  it('falls back to plain variable substitution for text the grammar rejects', () => {
    expect(renderText('{{ a b }} {{user.username}} {% x', lookup, bracket)).toBe(
      '{{ a b }} [alex] {% x'
    );
    expect(renderText('lone {{ and {{ user.username }}', lookup, same)).toBe('lone {{ and alex');
  });
});

describe('fitText', () => {
  it('returns text within the limit untouched', () => {
    expect(fitText('hello', { max: 5, unit: 'chars' })).toBe('hello');
  });

  it('cuts by code point and ends with an ellipsis counted in the limit', () => {
    expect(fitText('abcdef', { max: 4, unit: 'chars' })).toBe('abc…');
    expect(fitText('😀😀😀😀', { max: 3, unit: 'chars' })).toBe('😀😀…');
  });

  it('cuts by UTF-8 bytes without splitting a character', () => {
    const cut = fitText('😀😀😀', { max: 10, unit: 'bytes' });
    expect(cut).toBe('😀…');
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(10);
  });

  it('never leaves a lone escape backslash before the ellipsis', () => {
    expect(fitText('ab\\_cd', { max: 4, unit: 'chars' })).toBe('ab…');
    expect(fitText('a\\\\bcd', { max: 4, unit: 'chars' })).toBe('a\\\\…');
  });
});

describe('a plain-object lookup', () => {
  const lookup = (name: string) => values[name];
  const keep = (value: string) => value;

  it('renders prototype names as empty through the parser path', () => {
    expect(renderText('[{{ constructor }}]', lookup, keep)).toBe('[]');
    expect(renderText('{% if toString %}x{% else %}y{% endif %}', lookup, keep)).toBe('y');
    const parsed = parseTemplate('[{{ valueOf }}]');
    if (!parsed.ok) throw new Error('did not parse');
    expect(renderTemplate(parsed.nodes, lookup, keep)).toBe('[]');
  });

  it('renders prototype names as empty through the legacy path', () => {
    expect(renderText('{{constructor}} {%', lookup, keep)).toBe(' {%');
  });
});
