import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Existing process values win, then local overrides, then shared local defaults.
for (const name of ['.env.local', '.env']) {
  const file = new URL(`../${name}`, import.meta.url);
  if (existsSync(file)) process.loadEnvFile(fileURLToPath(file));
}
const result = spawnSync(process.execPath, ['scripts/api-python.mjs', '-m', 'app.calendar_check'], {
  cwd: root, env: process.env, stdio: 'inherit',
});
process.exit(result.status ?? 1);
