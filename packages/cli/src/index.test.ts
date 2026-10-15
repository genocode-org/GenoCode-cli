import { describe, expect, it } from "vitest";
import type { DesignOptions, DesignResult } from "@genocode/agent";
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
    exists: (p: string) => p in files,
    design: (_options: DesignOptions): Promise<DesignResult> =>
      Promise.reject(new Error("no designer in this test")),
  };
  return io;
}

const GOOD = "creature T\ngene n = 2 in 1..4 step 1  // how many\nrepeat n {\n  lay\n}\n";
const BLOB = "creature Blob\nlay\n";

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

  it("creates creatures from a description and saves them", async () => {
    const io = memoryIo({ "Blob.genie": "taken" });
    let asked: DesignOptions | undefined;
    io.design = async (options) => {
      asked = options;
      options.onProgress?.({ kind: "tool", name: "check", detail: "No problems." });
      return {
        creature: { name: "Blob", source: BLOB, warnings: [] },
        summary: "A blob.",
        stopReason: "end_turn",
      };
    };
    expect(await run(["create", "a", "round", "blob", "--model=m"], io)).toBe(0);
    expect(asked?.description).toBe("a round blob");
    expect(asked?.model).toBe("m");
    expect(io.files["Blob-2.genie"]).toBe(BLOB);
    expect(io.files["Blob.genie"]).toBe("taken");
    expect(io.stdout).toContain("Saved Blob-2.genie");
    expect(io.stderr).toContain("[check] No problems.");

    expect(await run(["create", "--out=Blob.genie", "a blob"], io)).toBe(1);
    expect(io.stderr).toContain("already exists");
    expect(await run(["create", "--out=Blob.genie", "--force", "a blob"], io)).toBe(0);
    expect(io.files["Blob.genie"]).toBe(BLOB);
  });

  it("reports when a creature can't be created", async () => {
    const io = memoryIo({});
    expect(await run(["create", "a blob"], io)).toBe(1);
    expect(io.stderr).toContain("ANTHROPIC_API_KEY");
    // Other API errors, such as a low credit balance, don't blame the credentials.
    const billing = memoryIo({});
    billing.design = () =>
      Promise.reject(Object.assign(new Error("400 credit too low"), { status: 400 }));
    expect(await run(["create", "a blob"], billing)).toBe(1);
    expect(billing.stderr).toBe("genie create: 400 credit too low\n");
    io.design = async () => ({ creature: undefined, summary: "", stopReason: "max_tokens" });
    expect(await run(["create", "a blob"], io)).toBe(1);
    expect(io.stderr).toContain("no creature was saved");
    expect(run(["create"], io)).toBe(1);
    expect(io.stderr).toContain("no description given");
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
});
