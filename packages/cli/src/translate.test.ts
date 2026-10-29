// The Pop here is written for the tests: no DancerDNA files are used.

import { build, check, valuesOf } from "@genocode/core";
import { describe, expect, it } from "vitest";
import { parsePop, readPopulation } from "./pop.js";
import { translatePopulation } from "./translate.js";

/** A genome: a program whose `main` is `body`, plus any other functions. */
const genome = (body: string, rest = "") =>
  `prog\nfunc void main();\nfunc void main() {\n${body}\n}\n${rest}`;

function translate(...genomes: string[]) {
  const t = translatePopulation("Test", genomes, "Test.pop");
  const program = check(t.text);
  const errors = program.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  return { ...t, program, errors };
}

/** Where each shape ends up. */
const centres = (text: string, variant?: string) => {
  const p = check(text);
  const v = p.variants.find((x) => x.name === variant);
  return build(p, { genes: valuesOf(p.genes, v?.values) }).shapes.map((s) =>
    [12, 13, 14].map((k) => Number(s.matrix[k]!.toFixed(4)) + 0),
  );
};

describe("reading populations", () => {
  it("reads a saved population's header and every genome", () => {
    const text =
      "pop dancers {\nframes 300\nend // DancerPop attributes\n" +
      "indi dancer { genome dancer { prog func void main() { lay(); } } }\n" +
      "indi dancer { genome dancer { prog func void main() { pitch([1]); } } }\n}\n";
    const name = "default setting";
    const bytes = new Uint8Array([
      name.length,
      ...new TextEncoder().encode(name),
      ...[text.length, 0, 0, 0],
      ...new TextEncoder().encode(text),
    ]);
    const pop = readPopulation(bytes);
    expect(pop.settings.get("frames")).toBe("300");
    expect(pop.genomes).toHaveLength(2);
    expect(parsePop(pop.genomes[1]!).functions[0]!.name).toBe("main");
  });

  it("keeps the later of two definitions of a function, as Pop runs it", () => {
    const p = parsePop("prog func void f() { lay(); } func void f() { forward([1]); }");
    expect(p.functions).toHaveLength(1);
    expect(p.functions[0]!.body[0]).toMatchObject({ k: "expr", e: { name: "forward" } });
  });
});

describe("translating", () => {
  it("turns genes into named genes, with ranges, steps and colours", () => {
    const t = translate(
      genome(`data num twist = [30.5]:[0]:[90];
data int petals = [7]:[3]:[12];
data vec3 stretch = [<1,2,3>]:[<0,0,0>]:[<4,4,4>];
data colour skin = [<0.5,0.6,0.7,0>]:[<0,0.4,0.5,0>]:[<0.99999,1,1,0>];
yaw(twist); set_colour(skin); uscale(iton(petals)); scale(stretch); lay();`),
    );
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("gene twist = 30.5 in 0..90");
    expect(t.text).toContain("gene petals = 7 in 3..12 step 1");
    expect(t.text).toContain("gene stretch = (1, 2, 3) in (0, 0, 0)..(4, 4, 4)");
    // Hue in degrees, and Pop's alpha left out: its shapes are drawn solid.
    expect(t.text).toMatch(
      /gene skin = hsv\(180, 0\.6, 0\.7\) in hsv\(0, 0\.4, 0\.5\)\.\.hsv\(359\.996, 1, 1\)/,
    );
  });

  it("names genes written inside expressions after where they're used", () => {
    const t = translate(genome("uscale([1.5]:[1]:[2]); uscale([1.2]:[1]:[2]); lay();"));
    expect(t.text).toMatch(/gene uscale_1 = 1\.5/);
    expect(t.text).toMatch(/gene uscale_2 = 1\.2/);
  });

  it("keeps other members as variants, with only the genes that differ", () => {
    const a = genome(
      "data num a = [1]:[0]:[2]; data num b = [1.5]:[0]:[2]; forward(a); uscale(b); lay();",
    );
    const b = a.replace("[1]:[0]:[2]", "[0.5]:[0]:[2]");
    const t = translate(a, b, a);
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("variant member_2 { a = 0.5 }");
    expect(t.text).toContain("variant member_3 {}");
    expect(centres(t.text, "member_2")[0]).toEqual([0, 0, 0.5]);
  });

  it("puts reversed ranges in order and widens ranges to take in every member", () => {
    const a = genome(
      "data num a = [1]:[4]:[-4]; data num b = [6]:[2]:[5]; forward(a); forward(b); lay();",
    );
    const t = translate(a, a.replace("[6]:[2]:[5]", "[1]:[2]:[5]"));
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("gene a = 1 in -4..4");
    expect(t.text).toContain("gene b = 6 in 1..6\n");
    expect(t.warnings.join("\n")).toContain("`b`'s range is widened");
  });

  it("turns radians into degrees, working out plain numbers", () => {
    const t = translate(
      genome("pitch([1.5707963]); yaw(dtor([30])); data num r = [0.5]; roll(sin(r)); lay();"),
    );
    expect(t.text).toContain("pitch pop_turn(90)");
    expect(t.text).toContain("yaw pop_turn(30)");
    expect(t.text).toContain("roll pop_turn(degrees(sin(degrees(r))))");
  });

  it("writes push() … pop() as a branch, and a reshaped lay as `lay { }`", () => {
    const t = translate(
      genome(
        "push(); forward([1]); lay(); pop(); push(); egg_scale([<1,2,1>]); egg_uscale([2]); lay(); pop();",
      ),
    );
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("branch {\n  forward 1\n  lay\n}");
    expect(t.text).toContain("lay { grow (1, 2, 1); grow 2 }");
  });

  it("declares variables before a branch when they're used after it", () => {
    const t = translate(genome("push(); data num d = [2]; pop(); forward(d); lay();"));
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("let d = 0\nbranch {\n  d = 2\n}\nforward d");
  });

  it("writes Pop's loops as `for` where they fit, and as `while` where they don't", () => {
    const t = translate(
      genome(`data int n = [4];
for( int i = [0]; iless(i,n); (i+[1]) ) { forward([1]); lay(); }
for( num x = [0]; lesseq(x,[1]); (x+[0.5]) ) { lay(); }
for( num y = [0]; less(y,[1]); (y+[0.5]) ) { lay(); }`),
    );
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("for i from 0 to n - 1 {");
    expect(t.text).toContain("for x from 0 to 1 by 0.5 {");
    expect(t.text).toContain("while y < 1 {");
    expect(build(t.program).shapes).toHaveLength(4 + 3 + 2);
  });

  it("keeps Pop's integer arithmetic and shape numbers", () => {
    const t = translate(
      genome(
        "data int a = [7]; data int b = [2]; data int q = (a/b); data int r = ntoi([2.7]); set_prim((q+r)); lay();",
      ),
    );
    expect(t.text).toContain("let q = floor(a / b)");
    expect(t.text).toContain("let r = floor(2.7)");
    expect(build(t.program).shapes[0]!.shape).toBe("donut");
  });

  it("scales shine and sharpness to GenoCode's 0 to 1", () => {
    const t = translate(genome("set_shine([3]); set_sharp([50]); lay();"));
    expect(t.text).toContain("shine 1\nsharpness 0.5");
  });

  it("turns the way Pop does on a mirrored turtle", () => {
    // Pop turns by the right-hand rule even when mirrored: here the second ball comes out where
    // the first went, not mirrored.
    const t = translate(
      genome(
        "push(); yaw([1.5707963]); forward([1]); lay(); pop(); scale([<-1,1,1>]); yaw([1.5707963]); forward([1]); lay();",
      ),
    );
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("function pop_turn(angle)");
    const [first, second] = centres(t.text);
    expect(second).toEqual(first);
  });

  it("makes colour spaces into functions that blend as Pop did", () => {
    const t = translate(
      genome(
        "buildSpace([0]); set_colour(cspace([0],[0.5])); lay(); data int k = [0]; set_colour(cspace(k,[1])); lay();",
        `func void buildSpace( int index ) {
data colour c0 = [<0.1,1,1,0>];
data colour c1 = [<0.9,1,1,0>];
init_cspace(index,c0);
extend_cspace(index,[1],c1);
}`,
      ),
    );
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("function pop_blend(a, b, amount)");
    expect(t.text).toContain("function pop_cspace(index, t)");
    const [half, end] = build(t.program).shapes;
    // Halfway from hue 36° to 324° in a straight line, not the short way round through 0°.
    expect(half!.colour.h).toBeCloseTo(180);
    expect(end!.colour.h).toBeCloseTo(324);
  });

  it("makes a colour space built among drawing into a function too", () => {
    const tip = (more: string) => `func void tip() {
data colour a = [<0.1,1,1,0>];
data colour b = [<0.9,1,1,0>];
init_cspace([0],a);
extend_cspace([0],[1],b);
${more}set_colour(cspace([0],[0.5]));
lay();
}`;
    const t = translate(genome("tip();", tip("")));
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("function tip_colours(colour_0, step_1, colour_1, t)");
    expect(t.text).not.toContain("TODO");
    expect(build(t.program).shapes[0]!.colour.h).toBeCloseTo(180);
    // When what it's built from changes, it's left to be done by hand.
    const changed = translate(genome("tip();", tip("a = [<0.5,1,1,0>];\n")));
    expect(changed.text).toContain("// TODO: build this colour space by hand");
  });

  it("marks what it can't translate with TODO comments", () => {
    const t = translate(genome("set_texture([2]); orbit([1]); lay();"));
    expect(t.text).toContain("// TODO: choose a texture");
    expect(t.text).toContain("// TODO: `orbit(…)` has no GenoCode translation.");
    expect(t.warnings.some((w) => w.startsWith("TODO"))).toBe(true);
  });

  it("gives names GenoCode keeps for itself another name", () => {
    const t = translate(
      genome("data num step = [1]; data num length = [2]; forward(step); forward(length); lay();"),
    );
    expect(t.errors).toEqual([]);
    expect(t.text).toContain("let step_ = 1");
    expect(t.text).toContain("let length_ = 2");
  });
});
