import { existsSync } from "node:fs";
import path from "node:path";

export {};

const args = process.argv.slice(2);
const developerMode = args.includes("--developer-mode");
const forwardedArgs = args.filter((arg) => arg !== "--developer-mode");
const cwd = process.cwd();
const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
const requiredDeps = [
  ["next", nextBin],
  ["typescript", path.join(cwd, "node_modules", "typescript", "package.json")],
];
const missingDeps = requiredDeps.filter(([, depPath]) => !existsSync(depPath));

if (missingDeps.length > 0) {
  const missingNames = missingDeps.map(([name]) => name).join(", ");
  console.error(
    `Missing local dependencies (${missingNames}). Run "bun install --frozen-lockfile" before starting the app.`,
  );
  process.exit(1);
}

const proc = Bun.spawn({
  cmd: [Bun.which("bun") ?? "bun", nextBin, "dev", ...forwardedArgs],
  cwd,
  env: {
    ...process.env,
    ...(developerMode
      ? {
          APP_MODE: "developer",
          NEXT_PUBLIC_APP_MODE: "developer",
        }
      : {}),
  },
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const exitCode = await proc.exited;
process.exit(exitCode);
