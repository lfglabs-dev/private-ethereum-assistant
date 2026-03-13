export {};

const args = process.argv.slice(2);
const developerMode = args.includes("--developer-mode");
const forwardedArgs = args.filter((arg) => arg !== "--developer-mode");

const proc = Bun.spawn({
  cmd: ["bunx", "next", "dev", ...forwardedArgs],
  cwd: process.cwd(),
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
