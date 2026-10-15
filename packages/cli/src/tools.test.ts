import { check } from "@genocode/core";
import { describe, expect, it } from "vitest";
import { describeGenes, renderPng } from "./tools.js";

const GOOD = "creature T\ngene n = 2 in 1..4 step 1  // how many\nrepeat n {\n  lay\n}\n";
// Two balls that move apart as time goes by.
const LIVE = "creature L\nlay\nmove (1 + 3 * time, 0, 0)\nlay\n";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("describeGenes", () => {
  it("lists genes with their ranges and descriptions", () => {
    expect(describeGenes(check(GOOD).genes)).toEqual(["n = 2 in 1..4 step 1  // how many"]);
  });
});

describe("renderPng", () => {
  it("builds the creature at the time asked for and draws a PNG", () => {
    const { png, built } = renderPng(check(LIVE), { size: 16, time: 2 });
    expect(built.shapes[1]!.matrix[12]).toBeCloseTo(7);
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});
