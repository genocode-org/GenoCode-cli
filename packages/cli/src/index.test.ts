import { describe, expect, it } from "vitest";
import { run, type Io } from "./index.js";

function memoryIo(
  files: Record<string, string>,
): Io & { stdout: string; stderr: string; files: Record<string, string> } {
  const io = {
    stdout: "",
    stderr: "",
    files,
    out: (t: string) => {
      io.stdout += t;
    },
    err: (t: string) => {
      io.stderr += t;
    },
    read: (p: string) => {
      const text = files[p];
      if (text === undefined) throw new Error("missing");
      return text;
    },
    write: (p: string, t: string | Uint8Array) => {
      files[p] = typeof t === "string" ? t : `<${t.length} bytes>`;
    },
  };
  return io;
}

const GOOD = "creature T\ngene n = 2 in 1..4 step 1  // how many\nrepeat n {\n  lay\n}\n";

describe("genie", () => {
  it("checks files and reports problems with their place", () => {
    const io = memoryIo({ "good.genie": GOOD, "bad.genie": "creature B\nforward red\n" });
    expect(run(["check", "good.genie"], io)).toBe(0);
    expect(run(["check", "good.genie", "bad.genie"], io)).toBe(1);
    expect(io.stderr).toBe("bad.genie:2:9: error: `forward` needs a number, not a colour.\n");
  });

  it("formats to stdout, checks and writes", () => {
    const io = memoryIo({ "a.genie": "creature A\nforward  1+2\n" });
    expect(run(["format", "a.genie"], io)).toBe(0);
    expect(io.stdout).toBe("creature A\nforward 1 + 2\n");
    expect(run(["format", "--check", "a.genie"], io)).toBe(1);
    expect(run(["format", "--write", "a.genie"], io)).toBe(0);
    expect(io.files["a.genie"]).toBe("creature A\nforward 1 + 2\n");
    expect(run(["format", "--check", "a.genie"], io)).toBe(0);
  });

  it("lists genes", () => {
    const io = memoryIo({ "good.genie": GOOD });
    expect(run(["genes", "good.genie"], io)).toBe(0);
    expect(io.stdout).toBe("n = 2 in 1..4 step 1  // how many\n");
  });

  it("lists variants and the genes each one sets", () => {
    const io = memoryIo({
      "good.genie": GOOD,
      "family.genie": `${GOOD}\nvariant Many { n = 4 }\n\nvariant Same {}\n`,
    });
    expect(run(["variants", "family.genie"], io)).toBe(0);
    expect(io.stdout).toBe("Many\n  n = 4\nSame\n  (sets no genes)\n");
    io.stdout = "";
    expect(run(["variants", "good.genie"], io)).toBe(0);
    expect(io.stdout).toBe("T has no variants\n");
  });

  it("builds creatures", () => {
    const io = memoryIo({ "good.genie": GOOD });
    expect(run(["build", "good.genie"], io)).toBe(0);
    expect(io.stdout).toBe("2 shapes: 2 balls\n");
  });

  it("renders pictures", () => {
    const io = memoryIo({ "good.genie": GOOD });
    let written: Uint8Array | undefined;
    io.write = (_p, data) => {
      written = data as Uint8Array;
    };
    expect(run(["render", "--size=32", "good.genie", "out.png"], io)).toBe(0);
    expect(Array.from(written!.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(run(["render", "--size=3", "good.genie", "out.png"], io)).toBe(1);
    expect(run(["render", "--time=-1", "good.genie", "out.png"], io)).toBe(1);
    expect(run(["render", "good.genie"], io)).toBe(1);
  });

  it("renders a creature at a moment in time", () => {
    // Two balls that move apart as time goes by.
    const io = memoryIo({ "live.genie": "creature L\nlay\nmove (1 + 3 * time, 0, 0)\nlay\n" });
    const pictures: Uint8Array[] = [];
    io.write = (_p, data) => {
      pictures.push(data as Uint8Array);
    };
    expect(run(["render", "--size=32", "live.genie", "a.png"], io)).toBe(0);
    expect(run(["render", "--size=32", "--time=0", "live.genie", "b.png"], io)).toBe(0);
    expect(run(["render", "--size=32", "--time=1", "live.genie", "c.png"], io)).toBe(0);
    expect(pictures[0]).toEqual(pictures[1]);
    expect(pictures[2]).not.toEqual(pictures[0]);
  });

  it("renders a pattern file as a ball wearing it", () => {
    const ripples = (rings: number) =>
      `pattern Ripples\n\nvalue picture {\n  value sin(r * ${rings} * 180) * 0.5 + 0.5\n}\n`;
    const io = memoryIo({ "a.genie": ripples(8), "b.genie": ripples(16) });
    const pictures: Uint8Array[] = [];
    io.write = (_p, data) => {
      pictures.push(data as Uint8Array);
    };
    expect(run(["render", "--size=32", "a.genie", "a.png"], io)).toBe(0);
    expect(run(["render", "--size=32", "b.genie", "b.png"], io)).toBe(0);
    expect(io.stderr).toBe("");
    expect(pictures[1]).not.toEqual(pictures[0]);
  });

  it("colours the banner only for a colour terminal", () => {
    const io = memoryIo({});
    io.colour = true;
    expect(run(["help"], io)).toBe(0);
    expect(io.stdout).toContain("[38;2;");
  });

  it("explains how to use it", () => {
    const io = memoryIo({});
    expect(run([], io)).toBe(1);
    expect(io.stdout).toContain("Usage: genie");
    expect(io.stdout).toContain("code, breed and share creatures");
    expect(io.stdout).not.toContain("[");
    expect(run(["check"], io)).toBe(1);
    expect(run(["check", "missing.genie"], io)).toBe(1);
    expect(io.stderr).toContain("can't read missing.genie");
  });

  it("mutates a creature, repeatably with --seed, keeping locked genes", () => {
    const source = "creature T\ngene a = 5 in 0..10\ngene b = 5 in 0..10\nlay\n";
    const io = memoryIo({ "t.genie": source });
    const args = ["mutate", "--strength=1", "--seed=7", "--lock=b", "t.genie"];
    expect(run([...args, "one.genie"], io)).toBe(0);
    expect(run([...args, "two.genie"], io)).toBe(0);
    expect(io.files["one.genie"]).toBe(io.files["two.genie"]);
    expect(io.files["one.genie"]).toMatch(/gene b = 5 +in 0..10/);
    expect(run(["check", "one.genie"], io)).toBe(0);
    expect(run(["mutate", "--strength=2", "t.genie"], io)).toBe(1);
  });

  it("breeds two creatures, with the first one's code", () => {
    const io = memoryIo({
      "a.genie": "creature A\ngene n = 0 in 0..10\nlay\n",
      "b.genie": "creature B\ngene n = 10 in 0..10\nshape cube\nlay\n",
    });
    expect(run(["breed", "--seed=1", "a.genie", "b.genie"], io)).toBe(0);
    expect(io.stdout).toMatch(/^creature A\n/);
    expect(run(["breed", "a.genie"], io)).toBe(1);
  });

  it("morphs between two creatures", () => {
    const io = memoryIo({
      "a.genie": "creature A\ngene n = 0 in 0..10\nlay\n",
      "b.genie": "creature B\ngene n = 10 in 0..10\nshape cube\nlay\n",
    });
    expect(run(["morph", "--at=0.25", "a.genie", "b.genie", "m.genie"], io)).toBe(0);
    expect(io.files["m.genie"]).toBe("creature A\ngene n = 2.5 in 0..10\nlay\n");
    expect(run(["morph", "--at=0.75", "a.genie", "b.genie", "m.genie"], io)).toBe(0);
    expect(io.files["m.genie"]).toContain("creature B\ngene n = 7.5 in 0..10");
  });

  it("translates a Pop population into one creature with variants", () => {
    const genome = (v: string) =>
      `genome dancer { prog func void main(); func void main() { data num reach = [${v}]:[0]:[3]; forward(reach); lay(); } }`;
    const pop = `pop dancers {\nend\nindi dancer { ${genome("1")} }\nindi dancer { ${genome("2")} }\n}\n`;
    const io = memoryIo({ "Worm.pop": pop });
    expect(run(["translate", "Worm.pop", "Worm.genie"], io)).toBe(0);
    expect(io.files["Worm.genie"]).toContain("creature Worm\n");
    expect(io.files["Worm.genie"]).toContain("gene reach = 1 in 0..3");
    expect(io.files["Worm.genie"]).toContain("variant member_2 { reach = 2 }");
    expect(run(["check", "Worm.genie"], io)).toBe(0);
    expect(run(["translate", "missing.pop"], io)).toBe(1);
  });
});
