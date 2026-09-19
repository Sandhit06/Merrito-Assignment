import * as fs from 'fs';
import * as path from 'path';
import { InventoryEvent, SkippedEvent, EventType } from './types';
import { SKU_CATALOG, KNOWN_EVENT_TYPES } from './catalog';

const CATALOG_SKUS = new Set(SKU_CATALOG.map((entry) => entry.sku));

export interface LoadResult {
  valid: InventoryEvent[];
  skipped: SkippedEvent[];
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return !Number.isNaN(Date.parse(value));
}

// Checks one raw record. Never throws - just returns either a clean event or a
// plain-English reason it got rejected, so the caller can log it and move on
// instead of blowing up on one bad row.
function validateRecord(raw: unknown): { event: InventoryEvent } | { reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'record is not a JSON object' };
  }

  const rec = raw as Record<string, unknown>;
  const { sku, channel, type, quantity, timestamp } = rec;

  if (typeof sku !== 'string' || sku.trim() === '') {
    return { reason: 'missing or invalid "sku"' };
  }
  if (!CATALOG_SKUS.has(sku)) {
    return { reason: `unknown SKU "${sku}" is not in the fixed catalog` };
  }
  if (typeof channel !== 'string' || channel.trim() === '') {
    return { reason: 'missing or invalid "channel"' };
  }
  if (typeof type !== 'string' || !(KNOWN_EVENT_TYPES as readonly string[]).includes(type)) {
    return { reason: `missing or unrecognized "type" (got ${JSON.stringify(type)})` };
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    return { reason: 'missing or non-numeric "quantity"' };
  }
  if (type === 'stock_snapshot') {
    // stock_snapshot.quantity is an absolute stock level, so 0 is fine (stocked out)
    // but negative isn't physically possible.
    if (quantity < 0) return { reason: 'stock_snapshot "quantity" cannot be negative' };
  } else if (quantity <= 0) {
    return { reason: `"${type}" event "quantity" must be a positive number` };
  }
  if (!isValidTimestamp(timestamp)) {
    return { reason: `missing or unparsable "timestamp" (got ${JSON.stringify(timestamp)})` };
  }

  return {
    event: {
      sku,
      channel,
      type: type as EventType,
      quantity,
      timestamp: timestamp as string,
    },
  };
}

// Same thing but takes an already-parsed array - split out mainly so tests can hit
// the validation logic directly without needing an actual file on disk.
export function parseEvents(records: unknown[]): LoadResult {
  const valid: InventoryEvent[] = [];
  const skipped: SkippedEvent[] = [];

  records.forEach((raw, index) => {
    const result = validateRecord(raw);
    if ('event' in result) {
      valid.push(result.event);
    } else {
      skipped.push({ index, raw, reason: result.reason });
    }
  });

  return { valid, skipped };
}

// Reads inventory_events.json off disk. One bad *event* just gets skipped (see
// validateRecord above), but if the whole file isn't valid JSON, or isn't even an
// array, that's a different class of problem and we throw - there's no sane way to
// "skip" a file that's broken at that level.
export function loadEvents(filePath: string): LoadResult {
  const absPath = path.resolve(filePath);
  const raw = fs.readFileSync(absPath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${absPath} as JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${absPath} to contain a top-level JSON array of events.`);
  }

  return parseEvents(parsed);
}
