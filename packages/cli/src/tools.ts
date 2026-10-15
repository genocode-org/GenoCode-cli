// Listing genes and drawing creatures to PNG, for `genie genes` and `genie render`.

import {
  build,
  buildBackground,
  formatValue,
  type BuildResult,
  type CheckResult,
  type GeneInfo,
} from "@genocode/core";
import { rasterize } from "@genocode/render";
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

export interface RenderOptions {
  /** Width and height of the picture in pixels. */
  size?: number;
  /** The value of `time`, in seconds. 0 is the rest pose. */
  time?: number;
}

/** Builds a checked creature at a moment in time and draws it as a PNG. */
export function renderPng(
  program: CheckResult,
  options: RenderOptions = {},
): { png: Uint8Array; built: BuildResult } {
  const size = options.size ?? 512;
  const inputs = { time: options.time ?? 0 };
  const built = build(program, { inputs });
  const image = rasterize(built.shapes, {
    width: size,
    height: size,
    background: buildBackground(program, { inputs }).fill,
  });
  return { png: encodePng(image.width, image.height, image.data), built };
}
