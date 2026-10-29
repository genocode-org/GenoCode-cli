import { check } from "@genocode/core";
import { describe, expect, it } from "vitest";
import { describeCheck, describeGenes, renderPng } from "./tools.js";

const GOOD = "creature T\ngene n = 2 in 1..4 step 1  // how many\nrepeat n {\n  lay\n}\n";
// Two balls that move apart as time goes by.
const LIVE = "creature L\nlay\nmove (1 + 3 * time, 0, 0)\nlay\n";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("describeCheck", () => {
  it("says OK and what the file holds", () => {
    expect(describeCheck("t.genie", check(GOOD))).toBe("t.genie: OK — creature T, 1 gene");
    const family = `${GOOD}\nvariant Many { n = 4 }\n\nvariant Few { n = 1 }\n\nbreed off\n`;
    expect(describeCheck("f.genie", check(family))).toBe(
      "f.genie: OK — creature T, 1 gene, 2 variants, breed off",
    );
    expect(describeCheck("l.genie", check(LIVE))).toBe("l.genie: OK — creature L, animated");
  });

  it("counts the problems when there are errors", () => {
    expect(describeCheck("b.genie", check("creature B\nforward red\n"))).toBe("b.genie: 1 error");
  });
});

describe("describeGenes", () => {
  it("lists genes with their ranges and descriptions", () => {
    expect(describeGenes(check(GOOD).genes)).toEqual(["n = 2 in 1..4 step 1 // how many"]);
  });
});

describe("renderPng", () => {
  it("builds the creature at the time asked for and draws a PNG", () => {
    const { png, built } = renderPng(check(LIVE), { size: 16, time: 2 });
    expect(built.shapes[1]!.matrix[12]).toBeCloseTo(7);
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});
