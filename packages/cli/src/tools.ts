// Listing genes and drawing creatures to PNG, for `genie genes` and `genie render`.

import {
  build,
  buildBackground,
  formatValue,
  patternOnBall,
  type BuildResult,
  type CheckResult,
  type GeneInfo,
  type MusicInputs,
  type Value,
} from "@genocode/core";
import { rasterize, type View } from "@genocode/render";
import { encodePng } from "./png.js";

/** One line per gene: its full name, value, range and description. */
export function describeGenes(genes: readonly GeneInfo[]): string[] {
  return genes.map((g) => {
    let range = "";
    if (g.options) range = ` from [${g.options.map(formatValue).join(", ")}]`;
    else if (g.min !== undefined && g.max !== undefined) {
      range = ` in ${formatValue(g.min)}..${formatValue(g.max)}`;
      if (g.hue) range += g.hue.whole ? ", any hue" : `, hue ${g.hue.start}+${g.hue.length}°`;
      if (g.step !== undefined) range += ` step ${g.step}`;
      if (g.log) range += " log";
    }
    return `${g.fullName} = ${formatValue(g.value)}${range}${g.description ? `  // ${g.description}` : ""}`;
  });
}

/** Each variant's name, then the genes it sets and their values, indented below it. */
export function describeVariants(program: CheckResult): string[] {
  return program.variants.flatMap((v) => [
    v.name,
    ...(v.values.size === 0
      ? ["  (sets no genes)"]
      : [...v.values].map(([gene, value]) => `  ${gene} = ${formatValue(value)}`)),
  ]);
}

export interface RenderOptions {
  /** Width and height of the picture in pixels. */
  size?: number;
  /** The value of `time`, in seconds. 0 is the rest pose. */
  time?: number;
  /** The value of `beat`, 0 on the beat rising towards 1. */
  beat?: number;
  /** `music` values, each 0 to 1; the rest are 0, as when no music is playing. */
  music?: Partial<MusicInputs>;
  /** Gene values to build with, such as a variant's. Genes left out keep their written values. */
  genes?: ReadonlyMap<string, Value> | undefined;
  /**
   * Where the creature is seen from; the front, from a little above, if left out. Several views
   * are drawn side by side, left to right.
   */
  views?: readonly View[];
}

/** Named views for `--view` and `--views`, in degrees of yaw and pitch. */
export const VIEWS: Record<string, View> = {
  front: { yaw: 0, pitch: 0 },
  right: { yaw: 90, pitch: 0 },
  back: { yaw: 180, pitch: 0 },
  left: { yaw: -90, pitch: 0 },
  top: { yaw: 0, pitch: 90 },
  bottom: { yaw: 0, pitch: -90 },
  "three-quarter": { yaw: 45, pitch: 30 },
};

/** The views `--views` draws when it names none. */
export const SHEET_VIEWS = ["front", "right", "back", "top", "three-quarter"];

/**
 * Reads a view: a name from VIEWS, or yaw and pitch in degrees, such as `30,10`. Pitch is from
 * -90 to 90. Returns what's wrong, if anything is.
 */
export function readView(text: string): View | string {
  const named = VIEWS[text];
  if (named) return named;
  const [yaw, pitch, extra] = text.split(",").map((t) => (t.trim() === "" ? NaN : Number(t)));
  if (extra !== undefined || !Number.isFinite(yaw) || !Number.isFinite(pitch)) {
    return `\`${text}\` isn't a view: give yaw and pitch in degrees, such as 30,10, or one of ${Object.keys(VIEWS).join(", ")}`;
  }
  if (Math.abs(pitch!) > 90) return `the pitch in \`${text}\` must be from -90 to 90`;
  return { yaw: yaw!, pitch: pitch! };
}

/** Builds a checked creature at a moment in time and draws it as a PNG. A pattern file is drawn
 * as a ball wearing its pattern, as the app shows it. */
export function renderPng(
  program: CheckResult,
  options: RenderOptions = {},
): { png: Uint8Array; built: BuildResult } {
  if (program.file.kind === "pattern") program = patternOnBall(program);
  const size = options.size ?? 512;
  const inputs = { time: options.time ?? 0, beat: options.beat ?? 0, music: options.music ?? {} };
  const genes = options.genes ?? new Map<string, Value>();
  const built = build(program, { inputs, genes });
  const background = buildBackground(program, { inputs, genes }).fill;
  const views = options.views ?? [undefined];
  const images = views.map((view) =>
    rasterize(built.shapes, { width: size, height: size, background, view }),
  );
  // Views side by side, with a see-through gap between them.
  const gap = Math.max(2, Math.round(size / 64));
  const width = size * images.length + gap * (images.length - 1);
  const data = new Uint8ClampedArray(width * size * 4);
  images.forEach((image, k) => {
    const left = k * (size + gap);
    for (let y = 0; y < size; y++) {
      data.set(image.data.subarray(y * size * 4, (y + 1) * size * 4), (y * width + left) * 4);
    }
  });
  return { png: encodePng(width, size, data), built };
}
