export {};

const args = process.argv.slice(2);

let timeout = "120000";
let maxConcurrency: string | undefined;
const patterns: string[] = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--timeout") {
    const next = args[index + 1];
    if (!next) {
      throw new Error("Missing value for --timeout.");
    }
    timeout = next;
    index += 1;
    continue;
  }

  if (arg === "--max-concurrency") {
    const next = args[index + 1];
    if (!next) {
      throw new Error("Missing value for --max-concurrency.");
    }
    maxConcurrency = next;
    index += 1;
    continue;
  }

  patterns.push(arg);
}

if (patterns.length === 0) {
  throw new Error("Provide at least one glob pattern.");
}

const fileSet = new Set<string>();
for (const pattern of patterns) {
  const glob = new Bun.Glob(pattern);
  for await (const match of glob.scan({ cwd: process.cwd() })) {
    fileSet.add(match);
  }
}

const files = [...fileSet].sort();
if (files.length === 0) {
  throw new Error(`No test files matched: ${patterns.join(", ")}`);
}

const proc = Bun.spawn({
  cmd: [
    "bun",
    "test",
    "--timeout",
    timeout,
    ...(maxConcurrency ? ["--max-concurrency", maxConcurrency] : []),
    ...files.map((file) => `./${file}`),
  ],
  cwd: process.cwd(),
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const exitCode = await proc.exited;
process.exit(exitCode);
