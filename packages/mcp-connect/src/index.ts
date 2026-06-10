export * from './config/codex-config.js';
export * from './config/toml.js';
export * from './fs/paths.js';
export * from './fs/backup.js';
export * from './plugin/install-codex-plugin.js';
export * from './clients/codex.js';
import { run } from './cli.js';
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
