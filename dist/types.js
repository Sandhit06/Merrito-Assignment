"use strict";
// Shared types for the pipeline.
//
// Internal stuff below is normal camelCase. The output shape (snake_case) is what
// actually gets written to disk - kept separate on purpose. Those fields mirror the
// brief's own worked example almost word for word (days_of_stock_remaining,
// reorder_quantity, etc) so it's easy to eyeball against their sample, but I didn't
// want snake_case leaking into the rest of the code.
Object.defineProperty(exports, "__esModule", { value: true });
