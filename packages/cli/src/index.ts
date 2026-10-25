// The genie command line: check, format, genes, variants, build and render, mutate, breed and morph
// creatures, and translate old Pop creatures.

import { readFileSync, writeFileSync } from "node:fs";
import {
  breed,
  build,
  check,
  familySpread,
  MUSIC_FIELDS,
  formatDiagnostic,
  formatText,
  morph,
  mulberry32,
  mutate,
  writeGenes,
  valuesOf,
  type CheckResult,
  type Diagnostic,
  type LineMap,
  type MusicInputs,
} from "@genocode/core";
import { banner } from "./banner.js";
import { PopError, readPopulation } from "./pop.js";
import { translatePopulation } from "./translate.js";
import {
  describeGenes,
  describeVariants,
  readView,
  renderPng,
  SHEET_VIEWS,
  VIEWS,
} from "./tools.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
  read(path: string): string;
  /** Reads a file's bytes. Without it, files are read as text. */
  readBytes?(path: string): Uint8Array;
  write(path: string, data: string | Uint8Array): void;
  /** Standard output is a terminal that shows colour. */
  colour?: boolean;
}

export const nodeIo: Io = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  read: (p) => readFileSync(p, "utf8"),
  readBytes: (p) => readFileSync(p),
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
  variants <file>             list a creature's variants and the genes each one sets
  build [--json] <file>       build a creature and report its shapes
  render [--size=N] [--time=T] [--beat=B] [--music=bass:0.8,mid_hit:1]
         [--variant=Name] [--view=V | --views[=V,V…]] <file> <out.png>
                              draw a creature as an N×N picture (default 512) at T seconds
                              (default 0, the rest pose), B of the way through a beat
                              (0 to 1, default 0) and with the music values given (each 0
                              to 1; the rest are 0); --variant draws one of its variants.
                              --view sees it from yaw,pitch in degrees (yaw 90 is its right
                              side, 180 the back; pitch 90 looks down from above) or a named
                              view: front, right, back, left, top, bottom, three-quarter.
                              --views draws several named views side by side, N×N each
                              (default front, right, back, top, three-quarter).
                              A pattern file is drawn as a ball wearing it
  mutate [--strength=S] [--seed=N] [--lock=a,b] <file> [out.genie]
                              a variation of a creature: about four genes move, by up to
                              S of their range (0 to 1, default 0.25), or of how far its
                              variants spread them
  breed [--seed=N] [--lock=a,b] <a> <b> [out.genie]
                              a child of two creatures, with A's code
  morph [--at=T] <a> <b> [out.genie]
                              the creature T of the way from A to B (0 to 1, default 0.5)

  translate <file.pop> [out.genie]
                              a rough GenoCode version of a DancerDNA population: one
                              creature, with the other members as variants

mutate, breed and morph print the new creature, or write it to out.genie. --seed makes
the result repeatable, and --lock keeps the named genes as they are. Creatures that say
\`breed off\` can't be mutated or bred.
`;

function report(io: Io, file: string, lines: LineMap, diagnostics: Diagnostic[]): boolean {
  for (const d of diagnostics) io.err(formatDiagnostic(d, lines, file) + "\n");
  return !diagnostics.some((d) => d.severity === "error");
}

/**
 * Reads `--music`, such as `bass:0.8,mid_hit:1`, into music values. Returns what's wrong, if
 * anything is.
 */
export function readMusic(text: string): Partial<MusicInputs> | string {
  const music: Partial<MusicInputs> = {};
  for (const item of text.split(",").filter(Boolean)) {
    const [field, value, extra] = item.split(":");
    if (!(MUSIC_FIELDS as readonly string[]).includes(field!)) {
      return `\`${field}\` isn't a music value; they are ${MUSIC_FIELDS.join(", ")}`;
    }
    const n = Number(value);
    if (value === undefined || value === "" || extra !== undefined || !(n >= 0 && n <= 1)) {
      return `give ${field} a number from 0 to 1, as in ${field}:0.8`;
    }
    music[field as keyof MusicInputs] = n;
  }
  return music;
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

    case "variants": {
      const file = files[0]!;
      const text = read(file);
      if (text === undefined) return 1;
      const result = check(text);
      if (!report(io, file, result.lines, result.diagnostics)) return 1;
      const lines = describeVariants(result);
      if (lines.length === 0) io.out(`${result.file.name || file} has no variants\n`);
      for (const line of lines) io.out(line + "\n");
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
      const beat = Number(option("beat") ?? 0);
      if (!(beat >= 0 && beat <= 1)) {
        io.err("genie render: --beat must be a number from 0 to 1\n");
        return 1;
      }
      const music = readMusic(option("music") ?? "");
      if (typeof music === "string") {
        io.err(`genie render: --music: ${music}\n`);
        return 1;
      }
      const one = option("view");
      const several = flags.has("--views") ? (option("views") ?? SHEET_VIEWS.join(",")) : undefined;
      if (one !== undefined && several !== undefined) {
        io.err("genie render: give --view or --views, not both\n");
        return 1;
      }
      const views = [];
      for (const v of one !== undefined ? [one] : (several?.split(",") ?? [])) {
        const view = one !== undefined ? readView(v) : VIEWS[v];
        if (view === undefined) {
          io.err(
            `genie render: --views: \`${v}\` isn't a view; they are ${Object.keys(VIEWS).join(", ")}\n`,
          );
          return 1;
        }
        if (typeof view === "string") {
          io.err(`genie render: --view: ${view}\n`);
          return 1;
        }
        views.push(view);
      }
      if (size * views.length > 16384) {
        io.err(
          `genie render: ${views.length} views of ${size}×${size} make too wide a picture; give a smaller --size\n`,
        );
        return 1;
      }
      const text = read(file!);
      if (text === undefined) return 1;
      const result = check(text);
      if (!report(io, file!, result.lines, result.diagnostics)) return 1;
      const name = option("variant");
      const variant = name === undefined ? undefined : result.variants.find((v) => v.name === name);
      if (name !== undefined && !variant) {
        const names = result.variants.map((v) => v.name);
        io.err(
          `genie render: ${file} has no variant \`${name}\`` +
            (names.length > 0 ? `; it has ${names.join(", ")}\n` : "; it has none\n"),
        );
        return 1;
      }
      const { png, built } = renderPng(result, {
        size,
        time,
        beat,
        music,
        genes: variant?.values,
        ...(views.length > 0 ? { views } : {}),
      });
      report(io, file!, result.lines, built.diagnostics);
      io.write(out, png);
      return built.ok ? 0 : 1;
    }

    case "mutate":
    case "breed":
    case "morph": {
      const inputs = command === "mutate" ? 1 : 2;
      if (files.length < inputs) {
        io.err(
          `genie ${command}: give ${inputs === 1 ? "a creature file" : "two creature files"}\n\n${USAGE}`,
        );
        return 1;
      }
      const out = files[inputs];
      const strength = Number(option("strength") ?? 0.25);
      if (!(strength >= 0 && strength <= 1)) {
        io.err("genie mutate: --strength must be a number from 0 to 1\n");
        return 1;
      }
      const at = Number(option("at") ?? 0.5);
      if (!(at >= 0 && at <= 1)) {
        io.err("genie morph: --at must be a number from 0 to 1\n");
        return 1;
      }
      const seed = option("seed");
      if (seed !== undefined && !/^\d+$/.test(seed)) {
        io.err(`genie ${command}: --seed must be a whole number\n`);
        return 1;
      }
      const random = seed === undefined ? Math.random : mulberry32(Number(seed));
      const locked = new Set(option("lock")?.split(",").filter(Boolean));

      const programs: CheckResult[] = [];
      for (const file of files.slice(0, inputs)) {
        const text = read(file);
        if (text === undefined) return 1;
        const result = check(text);
        if (!report(io, file, result.lines, result.diagnostics)) return 1;
        if (command !== "morph" && !result.breedable) {
          io.err(
            `genie ${command}: ${file} says \`breed off\`: its children don't keep its look\n`,
          );
          return 1;
        }
        programs.push(result);
      }
      const [a, b] = programs as [CheckResult, CheckResult | undefined];
      let program = a;
      let values;
      if (command === "mutate") {
        const family = [undefined, ...a.variants.map((v) => v.values)];
        const spread =
          family.length > 1
            ? familySpread(
                a.genes,
                family.map((v) => valuesOf(a.genes, v)),
              )
            : undefined;
        values = mutate(a.genes, undefined, { strength, random, locked, spread });
      } else if (command === "breed") {
        values = breed({ genes: a.genes }, { genes: b!.genes }, { random, locked });
      } else {
        const m = morph({ genes: a.genes }, { genes: b!.genes }, at);
        if (m.from === "b") program = b!;
        values = m.values;
      }
      const text = writeGenes(program, values);
      if (out === undefined) io.out(text);
      else io.write(out, text);
      return 0;
    }

    case "translate": {
      const [file, out] = files as [string, string | undefined];
      let bytes: Uint8Array;
      try {
        bytes = io.readBytes ? io.readBytes(file) : new TextEncoder().encode(io.read(file));
      } catch {
        io.err(`genie: can't read ${file}\n`);
        return 1;
      }
      const base = file.split(/[\\/]/).pop()!;
      let translation;
      try {
        const population = readPopulation(bytes);
        translation = translatePopulation(base.replace(/\.\w+$/, ""), population.genomes, base);
      } catch (e) {
        if (!(e instanceof PopError)) throw e;
        io.err(`genie translate: ${file}: ${e.message}\n`);
        return 1;
      }
      for (const w of translation.warnings) io.err(`${file}: ${w}\n`);
      const result = check(translation.text);
      const problems = result.diagnostics.length;
      if (problems > 0) {
        io.err(
          `${file}: the translation has ${problems} problem${problems === 1 ? "" : "s"} to fix by hand:\n`,
        );
        report(io, out ?? "(output)", result.lines, result.diagnostics);
      }
      if (out === undefined) io.out(translation.text);
      else io.write(out, translation.text);
      return 0;
    }

    default:
      io.err(`genie: unknown command \`${command}\`\n\n${USAGE}`);
      return 1;
  }
}
