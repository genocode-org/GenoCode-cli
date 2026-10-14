// The genie command line: check, format, genes, build and render. Translate comes later.

import { readFileSync, writeFileSync } from "node:fs";
import {
  build,
  buildBackground,
  check,
  formatDiagnostic,
  formatText,
  formatValue,
  type Diagnostic,
  type LineMap,
} from "@genocode/core";
import { rasterize } from "@genocode/render";
import { encodePng } from "./png.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  read(path: string): string;
  write(path: string, data: string | Uint8Array): void;
}

export const nodeIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, data) => writeFileSync(p, data),
};

const USAGE = `Usage: genie <command> [options] <files…>

Commands:
  check <files…>              report errors and warnings
  format [--write | --check] <files…>
                              print files in the standard layout; --write saves them,
                              --check only reports files that aren't formatted
  genes <file>                list a creature's genes
  build [--json] <file>       build a creature and report its shapes
  render [--size=N] <file> <out.png>
                              draw a creature, in its rest pose, as an N×N picture (default 512)
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
    io.out(USAGE);
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
      for (const g of result.genes) {
        let range = "";
        if (g.options) range = ` from [${g.options.map(formatValue).join(", ")}]`;
        else if (g.min !== undefined && g.max !== undefined) {
          range = ` in ${formatValue(g.min)}..${formatValue(g.max)}`;
          if (g.hue) range += g.hue.whole ? ", any hue" : `, hue ${g.hue.start}+${g.hue.length}°`;
          if (g.step !== undefined) range += ` step ${g.step}`;
          if (g.log) range += " log";
        }
        io.out(
          `${g.fullName} = ${formatValue(g.value)}${range}${g.description ? `  // ${g.description}` : ""}\n`,
        );
      }
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
      const text = read(file!);
      if (text === undefined) return 1;
      const result = check(text);
      if (!report(io, file!, result.lines, result.diagnostics)) return 1;
      const built = build(result);
      report(io, file!, result.lines, built.diagnostics);
      const image = rasterize(built.shapes, {
        width: size,
        height: size,
        background: buildBackground(result).fill,
      });
      io.write(out, encodePng(image.width, image.height, image.data));
      return built.ok ? 0 : 1;
    }

    default:
      io.err(`genie: unknown command \`${command}\`\n\n${USAGE}`);
      return 1;
  }
}
