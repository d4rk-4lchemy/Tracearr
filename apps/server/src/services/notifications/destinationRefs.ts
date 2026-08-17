import { isNotNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { rules } from '../../db/schema.js';

export interface DestinationRef {
  ruleId: string;
  ruleName: string;
  isActive: boolean;
}

/** Every rule, active or not; getActiveRulesV2 is cached and filters inactive rows, which must still block a delete. */
export async function rulesReferencingDestinations(): Promise<Map<string, DestinationRef[]>> {
  const rows = await db
    .select({ id: rules.id, name: rules.name, isActive: rules.isActive, actions: rules.actions })
    .from(rules)
    .where(isNotNull(rules.actions));

  const refs = new Map<string, DestinationRef[]>();
  for (const row of rows) {
    for (const action of row.actions?.actions ?? []) {
      if (action.type !== 'send') continue;
      for (const id of action.to) {
        const list = refs.get(id) ?? [];
        list.push({ ruleId: row.id, ruleName: row.name, isActive: row.isActive });
        refs.set(id, list);
      }
    }
  }
  return refs;
}
