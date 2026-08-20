import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = path.join(root, "services", "api");
const virtualEnvironmentPython = path.join(
  apiDirectory,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python = process.env.PYTHON || (existsSync(virtualEnvironmentPython) ? virtualEnvironmentPython : "python3");
const result = spawnSync(python, process.argv.slice(2), {
  cwd: apiDirectory,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
