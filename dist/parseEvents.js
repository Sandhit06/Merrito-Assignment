"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEvents = parseEvents;
exports.loadEvents = loadEvents;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const catalog_1 = require("./catalog");
const CATALOG_SKUS = new Set(catalog_1.SKU_CATALOG.map((entry) => entry.sku));
function isValidTimestamp(value) {
    if (typeof value !== 'string' || value.trim() === '')
        return false;
    return !Number.isNaN(Date.parse(value));
}
// Checks one raw record. Never throws - just returns either a clean event or a
// plain-English reason it got rejected, so the caller can log it and move on
// instead of blowing up on one bad row.
function validateRecord(raw) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { reason: 'record is not a JSON object' };
    }
    const rec = raw;
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
    if (typeof type !== 'string' || !catalog_1.KNOWN_EVENT_TYPES.includes(type)) {
        return { reason: `missing or unrecognized "type" (got ${JSON.stringify(type)})` };
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
        return { reason: 'missing or non-numeric "quantity"' };
    }
    if (type === 'stock_snapshot') {
        // stock_snapshot.quantity is an absolute stock level, so 0 is fine (stocked out)
        // but negative isn't physically possible.
        if (quantity < 0)
            return { reason: 'stock_snapshot "quantity" cannot be negative' };
    }
    else if (quantity <= 0) {
        return { reason: `"${type}" event "quantity" must be a positive number` };
    }
    if (!isValidTimestamp(timestamp)) {
        return { reason: `missing or unparsable "timestamp" (got ${JSON.stringify(timestamp)})` };
    }
    return {
        event: {
            sku,
            channel,
            type: type,
            quantity,
            timestamp: timestamp,
        },
    };
}
// Same thing but takes an already-parsed array - split out mainly so tests can hit
// the validation logic directly without needing an actual file on disk.
function parseEvents(records) {
    const valid = [];
    const skipped = [];
    records.forEach((raw, index) => {
        const result = validateRecord(raw);
        if ('event' in result) {
            valid.push(result.event);
        }
        else {
            skipped.push({ index, raw, reason: result.reason });
        }
    });
    return { valid, skipped };
}
// Reads inventory_events.json off disk. One bad *event* just gets skipped (see
// validateRecord above), but if the whole file isn't valid JSON, or isn't even an
// array, that's a different class of problem and we throw - there's no sane way to
// "skip" a file that's broken at that level.
function loadEvents(filePath) {
    const absPath = path.resolve(filePath);
    const raw = fs.readFileSync(absPath, 'utf-8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Failed to parse ${absPath} as JSON: ${err.message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`Expected ${absPath} to contain a top-level JSON array of events.`);
    }
    return parseEvents(parsed);
}
