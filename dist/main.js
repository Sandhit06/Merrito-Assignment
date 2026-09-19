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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const parseEvents_1 = require("./parseEvents");
const stockEngine_1 = require("./stockEngine");
const allocateBudget_1 = require("./allocateBudget");
const report_1 = require("./report");
const catalog_1 = require("./catalog");
function main() {
    const inputPath = process.argv[2] ?? path.join(__dirname, '..', 'data', 'inventory_events.json');
    const outputPath = process.argv[3] ?? path.join(__dirname, '..', 'output', 'recommendations.json');
    console.log(`Reading events from: ${path.resolve(inputPath)}`);
    const { valid, skipped } = (0, parseEvents_1.loadEvents)(inputPath);
    const asOf = (0, stockEngine_1.determineAsOf)(valid);
    const riskRecords = (0, stockEngine_1.computeAllRiskRecords)(catalog_1.SKU_CATALOG, valid, asOf);
    const recommendations = (0, allocateBudget_1.allocateBudget)(riskRecords, catalog_1.WEEKLY_REORDER_BUDGET);
    const output = (0, report_1.buildOutput)({
        asOf,
        totalEventsRead: valid.length + skipped.length,
        validEventsProcessed: valid.length,
        skippedEvents: skipped,
        weeklyReorderBudget: catalog_1.WEEKLY_REORDER_BUDGET,
        recommendations,
    });
    (0, report_1.printConsoleReport)(output);
    const outDir = path.dirname(outputPath);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`Full recommendations written to: ${path.resolve(outputPath)}`);
}
main();
