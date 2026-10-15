// The genie command line: check, format, genes, build and render. Translate comes later.

import { readFileSync, writeFileSync } from "node:fs";
import {
  build,
  check,
  formatDiagnostic,
  formatText,
  type Diagnostic,
  type LineMap,
} from "@genocode/core";
import { banner } from "./banner.js";
import { describeGenes, renderPng } from "./tools.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  read(path: string): string;
  write(path: string, data: string | Uint8Array): void;
  /** Standard output is a terminal that shows colour. */
  colour?: boolean;
}

export const nodeIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, data) => writeFileSync(p, data),
  colour: process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined,
};

const USAGE = `Usage: genie <command> [options] <files…>

Commands:
  check <files…>              report errors and warnings
  format [--write | --check] <files…>
                              print files in the standard layout; --write saves them,
                              --check only reports files that aren't formatted
  genes <file>                list a creature's genes
  build [--json] <file>       build a creature and report its shapes
  render [--size=N] [--time=T] <file> <out.png>
                              draw a creature as an N×N picture (default 512) at T seconds
                              (default 0, the rest pose)
`;

function report(io: Io, file: string, lines: LineMap, diagnostics: Diagnostic[]): boolean {
  for (const d of diagnostics) io.err(formatDiagnostic(d, lines, file) + "\n");
  return !diagnostics.some((d) => d.severity === "error");
}

/** Runs the command line and returns the exit code. */
export function run(argv: string[], io: Io = nodeIo): number {
  const [command, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith("--")).map((a) => a.split("=")[0]!));
  const option = (name: string): string | undefined =>
    rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const files = rest.filter((a) => !a.startsWith("--"));
  const read = (file: string): string | undefined => {
    try {
      return io.read(file);
    } catch {
      io.err(`genie: can't read ${file}\n`);
      return undefined;
    }
  };

  if (command === undefined || command === "help" || command === "--help") {
    io.out(`${banner(io.colour ?? false)}
${USAGE}`);
    return command === undefined ? 1 : 0;
  }
  if (files.length === 0) {
    io.err(`genie ${command}: no files given\n\n${USAGE}`);
    return 1;
  }

  switch (command) {
    case "check": {
      let ok = true;
      for (const file of files) {
        const text = read(file);
        if (text === undefined) {
          ok = false;
          continue;
        }
        const result = check(text);
        if (!report(io, file, result.lines, result.diagnostics)) ok = false;
      }
      return ok ? 0 : 1;
    }

    case "format": {
      let ok = true;
      for (const file of files) {
        const text = read(file);
        if (text === undefined) {
          ok = false;
          continue;
        }
        const result = formatText(text);
        if (result.text === undefined) {
          report(io, file, check(text).lines, result.diagnostics);
          ok = false;
          continue;
        }
        if (flags.has("--check")) {
          if (result.text !== text) {
            io.err(`${file}: not formatted\n`);
            ok = false;
          }
        } else if (flags.has("--write")) {
          if (result.text !== text) io.write(file, result.text);
        } else {
          io.out(result.text);
        }
      }
      return ok ? 0 : 1;
    }

    case "genes": {
      const file = files[0]!;
      const text = read(file);
      if (text === undefined) return 1;
      const result = check(text);
      if (!report(io, file, result.lines, result.diagnostics)) return 1;
      for (const line of describeGenes(result.genes)) io.out(line + "\n");
      return 0;
    }

    case "build": {
      const file = files[0]!;
      const text = read(file);
      if (text === undefined) return 1;
      const result = check(text);
      if (!report(io, file, result.lines, result.diagnostics)) return 1;
      const built = build(result);
      report(io, file, result.lines, built.diagnostics);
      for (const line of built.printed) io.out(line + "\n");
      if (flags.has("--json")) {
        io.out(JSON.stringify(built.shapes) + "\n");
      } else {
        const counts = new Map<string, number>();
        for (const s of built.shapes) counts.set(s.shape, (counts.get(s.shape) ?? 0) + 1);
        const summary = [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
        io.out(
          `${built.shapes.length} shape${built.shapes.length === 1 ? "" : "s"}${summary ? `: ${summary}` : ""}\n`,
        );
      }
      return built.ok ? 0 : 1;
    }

    case "render": {
      const [file, out] = files;
      if (out === undefined) {
        io.err(`genie render: give a creature file and the picture to write\n\n${USAGE}`);
        return 1;
      }
      const size = Number(option("size") ?? 512);
      if (!Number.isInteger(size) || size < 16 || size > 8192) {
        io.err("genie render: --size must be a whole number from 16 to 8192\n");
        return 1;
      }
      const time = Number(option("time") ?? 0);
      if (!Number.isFinite(time) || time < 0) {
        io.err("genie render: --time must be a number of seconds, 0 or more\n");
        return 1;
      }
      const text = read(file!);
      if (text === undefined) return 1;
      const result = check(text);
      if (!report(io, file!, result.lines, result.diagnostics)) return 1;
      const { png, built } = renderPng(result, { size, time });
      report(io, file!, result.lines, built.diagnostics);
      io.write(out, png);
      return built.ok ? 0 : 1;
    }

    default:
      io.err(`genie: unknown command \`${command}\`\n\n${USAGE}`);
      return 1;
  }
}
