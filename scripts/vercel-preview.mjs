import { spawnSync } from "node:child_process";

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

if (!Array.isArray(deployments) || deployments.length === 0) {
  process.stderr.write(
    [
      "Preview deployment refused: Vercel promotes a new project's first deployment to Production,",
      "even when --target preview is supplied. Bootstrap policy must be approved before this command",
      "can safely create a non-production deployment.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const deploy = spawnSync(
  "npx",
  [...vercel, "deploy", "--target", "preview", "--yes"],
  { ...options, stdio: "inherit" },
);

process.exit(deploy.status ?? 1);
