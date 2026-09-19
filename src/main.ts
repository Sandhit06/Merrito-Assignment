import * as fs from 'fs';
import * as path from 'path';
import { loadEvents } from './parseEvents';
import { determineAsOf, computeAllRiskRecords } from './stockEngine';
import { allocateBudget } from './allocateBudget';
import { buildOutput, printConsoleReport } from './report';
import { SKU_CATALOG, WEEKLY_REORDER_BUDGET } from './catalog';

function main(): void {
  const inputPath = process.argv[2] ?? path.join(__dirname, '..', 'data', 'inventory_events.json');
  const outputPath = process.argv[3] ?? path.join(__dirname, '..', 'output', 'recommendations.json');

  console.log(`Reading events from: ${path.resolve(inputPath)}`);

  const { valid, skipped } = loadEvents(inputPath);

  const asOf = determineAsOf(valid);
  const riskRecords = computeAllRiskRecords(SKU_CATALOG, valid, asOf);
  const recommendations = allocateBudget(riskRecords, WEEKLY_REORDER_BUDGET);

  const output = buildOutput({
    asOf,
    totalEventsRead: valid.length + skipped.length,
    validEventsProcessed: valid.length,
    skippedEvents: skipped,
    weeklyReorderBudget: WEEKLY_REORDER_BUDGET,
    recommendations,
  });

  printConsoleReport(output);

  const outDir = path.dirname(outputPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Full recommendations written to: ${path.resolve(outputPath)}`);
}

main();
