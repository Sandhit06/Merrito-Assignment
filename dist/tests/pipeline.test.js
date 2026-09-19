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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const path = __importStar(require("path"));
const parseEvents_1 = require("../parseEvents");
const stockEngine_1 = require("../stockEngine");
const allocateBudget_1 = require("../allocateBudget");
const catalog_1 = require("../catalog");
const SAMPLE_DATA_PATH = path.join(__dirname, '..', '..', 'data', 'inventory_events.json');
(0, node_test_1.test)('REQUIRED: at least one malformed event in the sample data is skipped without crashing', () => {
    const { valid, skipped } = (0, parseEvents_1.loadEvents)(SAMPLE_DATA_PATH);
    strict_1.default.ok(valid.length > 0, 'expected some valid events to be parsed');
    strict_1.default.ok(skipped.length >= 1, 'expected the sample dataset to contain at least one malformed event');
    // Sanity check a few of the specific malformed cases the sample data was designed to cover.
    const reasons = skipped.map((s) => s.reason).join(' | ');
    strict_1.default.match(reasons, /quantity/i);
    strict_1.default.match(reasons, /timestamp/i);
});
(0, node_test_1.test)('end-to-end: full pipeline on the sample dataset never over-allocates the weekly budget', () => {
    const { valid } = (0, parseEvents_1.loadEvents)(SAMPLE_DATA_PATH);
    const asOf = (0, stockEngine_1.determineAsOf)(valid);
    const riskRecords = (0, stockEngine_1.computeAllRiskRecords)(catalog_1.SKU_CATALOG, valid, asOf);
    const recommendations = (0, allocateBudget_1.allocateBudget)(riskRecords, catalog_1.WEEKLY_REORDER_BUDGET);
    strict_1.default.equal(recommendations.length, catalog_1.SKU_CATALOG.length);
    const totalAllocated = recommendations.reduce((sum, r) => sum + r.reorderCost, 0);
    strict_1.default.ok(totalAllocated <= catalog_1.WEEKLY_REORDER_BUDGET, 'total allocated cost must never exceed the weekly budget');
});
(0, node_test_1.test)("end-to-end: sample dataset's SKU-101 matches the brief's worked example exactly", () => {
    const { valid } = (0, parseEvents_1.loadEvents)(SAMPLE_DATA_PATH);
    const asOf = (0, stockEngine_1.determineAsOf)(valid);
    const riskRecords = (0, stockEngine_1.computeAllRiskRecords)(catalog_1.SKU_CATALOG, valid, asOf);
    const sku101 = riskRecords.find((r) => r.sku === 'SKU-101');
    strict_1.default.ok(sku101);
    strict_1.default.equal(sku101.atRisk, true);
    strict_1.default.equal(sku101.daysOfStockRemaining, 8);
    strict_1.default.equal(sku101.idealReorderQuantity, 60);
    strict_1.default.equal(sku101.idealReorderCost, 12000);
});
