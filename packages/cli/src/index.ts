// The genie command line: check, format, genes, build, render and create. Translate comes later.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  build,
  check,
  formatDiagnostic,
  formatText,
  type Diagnostic,
  type LineMap,
} from "@genocode/core";
import {
  describeGenes,
  designCreature,
  renderPng,
  type DesignOptions,
  type DesignResult,
} from "@genocode/agent";
import { banner } from "./banner.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  read(path: string): string;
  write(path: string, data: string | Uint8Array): void;
  exists(path: string): boolean;
  /** Designs a creature, for `genie create`. */
  design(options: DesignOptions): Promise<DesignResult>;
  /** Standard output is a terminal that shows colour. */
  colour?: boolean;
}

export const nodeIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, data) => writeFileSync(p, data),
  exists: (p) => existsSync(p),
  design: designCreature,
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
  create [--out=FILE] [--force] [--model=M] <description…>
                              design a creature from a description with Claude, then save it
                              as FILE (default <Name>.genie). Needs ANTHROPIC_API_KEY or
                              \`ant auth login\`
`;

function report(io: Io, file: string, lines: LineMap, diagnostics: Diagnostic[]): boolean {
  for (const d of diagnostics) io.err(formatDiagnostic(d, lines, file) + "\n");
  return !diagnostics.some((d) => d.severity === "error");
}

/** Runs the command line and returns the exit code (a promise of it, for `create`). */
export function run(argv: string[], io: Io = nodeIo): number | Promise<number> {
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
    io.err(
      `genie ${command}: ${command === "create" ? "no description given" : "no files given"}\n\n${USAGE}`,
    );
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

    case "create":
      return create(files.join(" "), io, {
        out: option("out"),
        model: option("model"),
        force: flags.has("--force"),
      });

    default:
      io.err(`genie: unknown command \`${command}\`\n\n${USAGE}`);
      return 1;
  }
}

/** `genie create`: designs a creature with Claude and saves it. */
async function create(
  description: string,
  io: Io,
  options: { out: string | undefined; model: string | undefined; force: boolean },
): Promise<number> {
  if (options.out !== undefined && io.exists(options.out) && !options.force) {
    io.err(`genie create: ${options.out} already exists; use --force to replace it\n`);
    return 1;
  }
  let result: DesignResult;
  try {
    result = await io.design({
      description,
      ...(options.model !== undefined && { model: options.model }),
      onProgress: (p) => io.err(p.kind === "text" ? `${p.text}\n` : `  [${p.name}] ${p.detail}\n`),
    });
  } catch (e) {
    io.err(`genie create: ${e instanceof Error ? e.message : String(e)}\n`);
    // API errors carry an HTTP status; missing credentials fail before any request, without one.
    const status = (e as { status?: unknown }).status;
    if (status === undefined || status === 401 || status === 403) {
      io.err("It needs Claude API credentials: set ANTHROPIC_API_KEY, or run `ant auth login`.\n");
    }
    return 1;
  }
  const creature = result.creature;
  if (creature === undefined) {
    io.err(`genie create: no creature was saved (the agent stopped: ${result.stopReason})\n`);
    if (result.summary) io.out(result.summary + "\n");
    return 1;
  }
  let path = options.out;
  if (path === undefined) {
    // Never replace a file without being asked: number the new one instead.
    path = `${creature.name}.genie`;
    for (let n = 2; io.exists(path) && !options.force; n++) path = `${creature.name}-${n}.genie`;
  }
  io.write(path, creature.source);
  for (const w of creature.warnings) io.err(w.replace(/^creature:/, `${path}:`) + "\n");
  io.out(`${result.summary}\n\nSaved ${path}\n`);
  return 0;
}
