import { spawnSync } from "node:child_process";

if (process.env.ALLOW_FIXTURE_PRODUCTION_BOOTSTRAP !== "1") {
  process.stderr.write(
    "Bootstrap refused. Set ALLOW_FIXTURE_PRODUCTION_BOOTSTRAP=1 after confirming Production is fixture-backed and noindex.\n",
  );
  process.exit(2);
}

const vercel = ["--yes", "vercel@58.7.1"];
const options = {
  encoding: "utf8",
  env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
};
const list = spawnSync("npx", [...vercel, "list", "--json"], options);

if (list.status !== 0) {
  process.stderr.write(list.stderr ?? "Unable to inspect Vercel deployments.\n");
  process.exit(list.status ?? 1);
}

let deployments;
try {
  deployments = JSON.parse(list.stdout).deployments;
} catch {
  process.stderr.write("Unable to parse the Vercel deployment list.\n");
  process.exit(1);
}

if (Array.isArray(deployments) && deployments.length > 0) {
  process.stderr.write("Bootstrap refused because this project already has deployment history.\n");
  process.exit(2);
}

const deploy = spawnSync("npx", [...vercel, "deploy", "--prod", "--yes"], {
  ...options,
  stdio: "inherit",
});
process.exit(deploy.status ?? 1);
