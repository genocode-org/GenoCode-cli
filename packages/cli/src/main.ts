#!/usr/bin/env node
import { run } from "./index.js";

// Output piped into a command that stops reading early, such as `head`, isn't an error.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code !== "EPIPE") throw e;
  process.exit(process.exitCode ?? 0);
});

process.exitCode = run(process.argv.slice(2));
