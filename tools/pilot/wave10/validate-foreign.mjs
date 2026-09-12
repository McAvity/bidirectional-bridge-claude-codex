// Operator-only: validate exact arguments against a pinned runtime's real MCP Zod shape.
// Imports definitions only; never constructs a server or calls a tool handler.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [runtime, file] = process.argv.slice(2);
if (!runtime || !file) throw new Error('usage: validate-foreign.mjs PINNED_RUNTIME ARGUMENTS_JSON');
const { TOOLS } = await import(pathToFileURL(resolve(runtime, 'shared/mcp-server-core/dist/tools.js')));
const { z } = await import(pathToFileURL(resolve(runtime, 'node_modules/zod/index.js')));
const shape = z.object(TOOLS.find(t => t.name === 'bridge_create_task').inputShape);
const args = JSON.parse(readFileSync(file, 'utf8'));
shape.parse(args);
const invalid = structuredClone(args);
invalid.spec.scope.paths = [];
if (shape.safeParse(invalid).success) throw new Error('negative schema control unexpectedly passed');
console.log(JSON.stringify({ valid: true, empty_paths_rejected: true, handlers_called: 0, models_run: false }));
