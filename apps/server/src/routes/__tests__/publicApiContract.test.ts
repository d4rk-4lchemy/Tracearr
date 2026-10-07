/**
 * Public API contract baseline
 *
 * Reduces both OpenAPI documents to what a client depends on (operations,
 * parameters, request body and the dereferenced 200 response shape) and
 * checks every operation in the committed baseline is still there unchanged.
 * Additions are allowed: a new operation, a new optional parameter, a new
 * response property. Tags are compared exactly, since the first tag is what a
 * generated SDK names its class after.
 *
 * Regenerate the baseline only for a deliberate change, by running this file
 * with UPDATE_PUBLIC_API_CONTRACT=1 set, and read the fixture diff.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateOpenAPIDocument } from '../public.openapi.js';
import { generateOpenAPIDocumentV2 } from '../publicV2.openapi.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'publicApiContract.json');

type Json = Record<string, unknown>;

const SHAPE_KEYS = [
  'type',
  'format',
  'nullable',
  'enum',
  'properties',
  'required',
  'items',
  'oneOf',
  'anyOf',
  'allOf',
  'additionalProperties',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'default',
] as const;

const CONSTRAINT_KEYS = [
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
] as const;

interface Body {
  mediaType: string;
  schema: unknown;
}

interface Operation {
  tags: string[];
  parameters: Record<string, { required: boolean; schema: unknown }>;
  request: (Body & { required: boolean }) | null;
  responses: Record<string, Body>;
}

type Contract = Record<string, Operation>;

function reduceSchema(node: unknown, components: Json, seen: string[]): unknown {
  if (typeof node !== 'object' || node === null) return node;
  const obj = node as Json;
  if (typeof obj.$ref === 'string') {
    const name = obj.$ref.replace('#/components/schemas/', '');
    if (seen.includes(name)) return { $ref: name };
    return reduceSchema(components[name], components, [...seen, name]);
  }
  const out: Json = {};
  for (const key of SHAPE_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value as Json).map(([name, s]) => [name, reduceSchema(s, components, seen)])
      );
    } else if (key === 'items' || key === 'additionalProperties') {
      out[key] = typeof value === 'object' ? reduceSchema(value, components, seen) : value;
    } else if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      out[key] = (value as unknown[]).map((s) => reduceSchema(s, components, seen));
    } else if (key === 'required') {
      out.required = [...(value as string[])].sort();
    } else {
      out[key] = value;
    }
  }
  return out;
}

function firstBody(holder: Json | undefined, components: Json): Body | null {
  const content = holder?.content as Json | undefined;
  const entry = content ? Object.entries(content)[0] : undefined;
  if (!entry) return null;
  const [mediaType, media] = entry;
  return { mediaType, schema: reduceSchema((media as Json).schema, components, []) };
}

function contractOf(spec: Json): Contract {
  const components = ((spec.components as Json | undefined)?.schemas ?? {}) as Json;
  const out: Contract = {};
  for (const [path, methods] of Object.entries(spec.paths as Json)) {
    for (const [method, op] of Object.entries(methods as Json)) {
      const o = op as Json;
      const parameters: Operation['parameters'] = {};
      for (const p of (o.parameters as Json[] | undefined) ?? []) {
        parameters[`${String(p.in)}:${String(p.name)}`] = {
          required: p.required === true,
          schema: reduceSchema(p.schema, components, []),
        };
      }
      const requestBody = o.requestBody as Json | undefined;
      const request = firstBody(requestBody, components);
      const responses: Operation['responses'] = {};
      for (const [status, holder] of Object.entries((o.responses as Json | undefined) ?? {})) {
        const body = firstBody(holder as Json, components);
        if (body) responses[status] = body;
      }
      out[`${method.toUpperCase()} ${path}`] = {
        tags: (o.tags as string[] | undefined) ?? [],
        parameters,
        request: request ? { ...request, required: requestBody?.required === true } : null,
        responses,
      };
    }
  }
  return out;
}

/**
 * Every baseline key is still there with the same shape. New properties are
 * allowed. A response may gain required names; a request may not, since that
 * breaks a caller that never sent them. Enums compare exactly: a strict client
 * fails on a value it has not seen, and for the same reason a response union
 * (oneOf, anyOf) may not gain a variant. A request may not gain a constraint
 * or an allOf member, since either rejects a body that is accepted today.
 * A field that becomes nullable fails.
 */
function expectShapeKept(
  baseline: unknown,
  current: unknown,
  at: string,
  side: 'request' | 'response'
): void {
  if (typeof baseline !== 'object' || baseline === null) {
    expect(current, at).toEqual(baseline);
    return;
  }
  expect(typeof current === 'object' && current !== null, at).toBe(true);
  if (Array.isArray(baseline)) {
    const list = current as unknown[];
    expect(list.length, at).toBeGreaterThanOrEqual(baseline.length);
    baseline.forEach((entry, i) => expectShapeKept(entry, list[i], `${at}[${i}]`, side));
    return;
  }
  const base = baseline as Json;
  const cur = current as Json;
  expect(cur.nullable === true && base.nullable !== true, `${at} became nullable`).toBe(false);
  for (const [key, value] of Object.entries(base)) {
    if (key === 'properties') {
      for (const [name, shape] of Object.entries(value as Json)) {
        expectShapeKept(shape, (cur.properties as Json | undefined)?.[name], `${at}.${name}`, side);
      }
    } else if (key === 'required') {
      if (side === 'response') {
        expect(cur.required, `${at}.required`).toEqual(expect.arrayContaining(value as unknown[]));
      } else {
        expect(value, `${at}.required gained names`).toEqual(
          expect.arrayContaining((cur.required as unknown[] | undefined) ?? [])
        );
      }
    } else if (key === 'enum') {
      expect(cur.enum, `${at}.enum`).toEqual(value);
    } else if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
      const members = value as unknown[];
      const list = (cur[key] as unknown[] | undefined) ?? [];
      const mayGrow = key === 'allOf' ? side === 'response' : side === 'request';
      if (mayGrow) {
        expect(list.length, `${at}.${key}`).toBeGreaterThanOrEqual(members.length);
      } else {
        expect(list.length, `${at}.${key} member count`).toBe(members.length);
      }
      members.forEach((m, i) => expectShapeKept(m, list[i], `${at}.${key}[${i}]`, side));
    } else {
      expectShapeKept(value, cur[key], `${at}.${key}`, side);
    }
  }
  if (side === 'request') {
    if (!('required' in base) && Array.isArray(cur.required)) {
      expect(cur.required, `${at}.required gained names`).toEqual([]);
    }
    for (const key of CONSTRAINT_KEYS) {
      expect(key in cur && !(key in base), `${at} gained ${key}`).toBe(false);
    }
  }
}

function expectOperationKept(op: Operation, now: Operation | undefined, key: string): void {
  expect(now, key).toBeDefined();
  if (!now) return;
  for (const [name, param] of Object.entries(op.parameters)) {
    expect(now.parameters[name], `${key} ${name}`).toEqual(param);
  }
  for (const [name, param] of Object.entries(now.parameters)) {
    if (!(name in op.parameters)) expect(param.required, `${key} new ${name}`).toBe(false);
  }
  if (op.request) {
    expect(now.request?.mediaType, `${key} request media type`).toBe(op.request.mediaType);
    expectShapeKept(op.request.schema, now.request?.schema, `${key} request`, 'request');
  }
  expect(
    now.request?.required === true && op.request?.required !== true,
    `${key} request body became required`
  ).toBe(false);
  for (const [status, body] of Object.entries(op.responses)) {
    const at = `${key} ${status}`;
    expect(now.responses[status]?.mediaType, `${at} media type`).toBe(body.mediaType);
    expectShapeKept(body.schema, now.responses[status]?.schema, at, 'response');
  }
}

describe('public API contract', () => {
  const documents = {
    v1: generateOpenAPIDocument() as Json,
    v2: generateOpenAPIDocumentV2() as Json,
  };
  const current = { v1: contractOf(documents.v1), v2: contractOf(documents.v2) };

  it('never sets operationId, so generated SDK method names keep deriving from the path', () => {
    for (const spec of Object.values(documents)) {
      for (const methods of Object.values(spec.paths as Json)) {
        for (const op of Object.values(methods as Json)) {
          expect((op as Json).operationId).toBeUndefined();
        }
      }
    }
  });

  it('keeps every baseline operation, parameter, request and response shape', () => {
    if (process.env.UPDATE_PUBLIC_API_CONTRACT === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(current, null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(FIXTURE, 'utf8')) as typeof current;

    for (const version of ['v1', 'v2'] as const) {
      for (const [key, op] of Object.entries(baseline[version])) {
        const now = current[version][key];
        expect(now?.tags, key).toEqual(op.tags);
        expectOperationKept(op, now, key);
      }
    }
  });

  describe('the comparator itself', () => {
    const shape = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        state: { type: 'string', enum: ['up', 'down'] },
        name: { type: 'string' },
      },
    };
    const mutate = (fn: (copy: typeof shape) => void) => {
      const copy = JSON.parse(JSON.stringify(shape)) as typeof shape;
      fn(copy);
      return copy;
    };

    it('allows a new property and a new required response name', () => {
      const grown = mutate((c) => {
        (c.properties as Json).extra = { type: 'number' };
        c.required.push('name');
      });
      expect(() => expectShapeKept(shape, grown, 'x', 'response')).not.toThrow();
    });

    it('fails when a property goes missing', () => {
      const lost = mutate((c) => {
        delete (c.properties as Json).name;
      });
      expect(() => expectShapeKept(shape, lost, 'x', 'response')).toThrow();
    });

    it('fails when a property becomes nullable', () => {
      const nullable = mutate((c) => {
        (c.properties.name as Json).nullable = true;
      });
      expect(() => expectShapeKept(shape, nullable, 'x', 'response')).toThrow();
    });

    it('fails when an enum gains or loses a value', () => {
      const gained = mutate((c) => c.properties.state.enum.push('unknown'));
      const lost = mutate((c) => c.properties.state.enum.pop());
      expect(() => expectShapeKept(shape, gained, 'x', 'response')).toThrow();
      expect(() => expectShapeKept(shape, lost, 'x', 'response')).toThrow();
    });

    it('fails when a request property becomes required', () => {
      const stricter = mutate((c) => c.required.push('name'));
      expect(() => expectShapeKept(shape, stricter, 'x', 'request')).toThrow();
      expect(() => expectShapeKept(shape, stricter, 'x', 'response')).not.toThrow();
    });

    it('fails when a request property gains or tightens a length limit', () => {
      const limited = mutate((c) => {
        (c.properties.name as Json).maxLength = 10;
      });
      const base = mutate((c) => {
        (c.properties.name as Json).maxLength = 255;
      });
      expect(() => expectShapeKept(shape, limited, 'x', 'request')).toThrow();
      expect(() => expectShapeKept(base, limited, 'x', 'request')).toThrow();
      expect(() => expectShapeKept(shape, limited, 'x', 'response')).not.toThrow();
    });

    it('lets a union gain a variant on a request but not on a response', () => {
      const union = { oneOf: [{ type: 'string' }, { type: 'number' }] };
      const grown = { oneOf: [...union.oneOf, { type: 'boolean' }] };
      expect(() => expectShapeKept(union, grown, 'x', 'request')).not.toThrow();
      expect(() => expectShapeKept(union, grown, 'x', 'response')).toThrow();
      const anyOf = { anyOf: union.oneOf };
      expect(() => expectShapeKept(anyOf, { anyOf: grown.oneOf }, 'x', 'response')).toThrow();
    });

    it('lets allOf gain a member on a response but not on a request', () => {
      const all = { allOf: [{ type: 'object', properties: { id: { type: 'string' } } }] };
      const grown = { allOf: [...all.allOf, { type: 'object', required: ['name'] }] };
      expect(() => expectShapeKept(all, grown, 'x', 'response')).not.toThrow();
      expect(() => expectShapeKept(all, grown, 'x', 'request')).toThrow();
    });

    const operation: Operation = {
      tags: [],
      parameters: {},
      request: { mediaType: 'application/json', required: false, schema: shape },
      responses: {
        '200': { mediaType: 'application/json', schema: shape },
        '400': { mediaType: 'application/json', schema: { type: 'object' } },
      },
    };
    const mutateOperation = (fn: (copy: Operation) => void) => {
      const copy = JSON.parse(JSON.stringify(operation)) as Operation;
      fn(copy);
      return copy;
    };

    it('fails when a response status loses its body or changes media type', () => {
      const lost = mutateOperation((c) => {
        delete c.responses['400'];
      });
      const retyped = mutateOperation((c) => {
        c.responses['200'] = { mediaType: 'text/event-stream', schema: shape };
      });
      const added = mutateOperation((c) => {
        c.responses['404'] = { mediaType: 'application/json', schema: { type: 'object' } };
      });
      expect(() => expectOperationKept(operation, lost, 'op')).toThrow();
      expect(() => expectOperationKept(operation, retyped, 'op')).toThrow();
      expect(() => expectOperationKept(operation, added, 'op')).not.toThrow();
    });

    it('fails when a request body becomes required', () => {
      const stricter = mutateOperation((c) => {
        if (c.request) c.request.required = true;
      });
      const relaxed = mutateOperation((c) => {
        if (c.request) c.request.required = false;
      });
      expect(() => expectOperationKept(operation, stricter, 'op')).toThrow();
      expect(() => expectOperationKept(stricter, relaxed, 'op')).not.toThrow();
      expect(() => expectOperationKept({ ...operation, request: null }, stricter, 'op')).toThrow();
    });
  });
});
