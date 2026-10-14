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
    expect(run(["render", "good.genie"], io)).toBe(1);
  });

  it("explains how to use it", () => {
    const io = memoryIo({});
    expect(run([], io)).toBe(1);
    expect(io.stdout).toContain("Usage: genie");
    expect(run(["check"], io)).toBe(1);
    expect(run(["check", "missing.genie"], io)).toBe(1);
    expect(io.stderr).toContain("can't read missing.genie");
  });
});
