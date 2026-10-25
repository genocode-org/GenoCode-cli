// genie translate: a rough first conversion of a Pop population (DancerDNA, 1999) into one
// GenoCode creature, following the table in LANGUAGE.md's notes on Pop. The first member's program
// becomes the creature, its genes become named genes, and the other members become variants. The
// result is meant to be tidied by hand: it keeps Pop's structure, and marks what it couldn't
// translate with `// TODO` comments.

import { formatText, isBuiltinName, KEYWORDS, SHAPES } from "@genocode/core";
import {
  genesOf,
  isGene,
  parsePop,
  type PopConst,
  type PopExpr,
  type PopFunction,
  type PopProgram,
  type PopStmt,
  type PopType,
} from "./pop.js";

export interface Translation {
  text: string;
  /** Things to look at when tidying by hand. */
  warnings: string[];
}

type Type = "num" | "int" | "bool" | "vec3" | "colour" | "unknown";

interface Code {
  code: string;
  type: Type;
}

interface Gene {
  name: string;
  /** The part or function it's declared in. */
  owner: string | undefined;
  node: PopConst;
  /** The Pop type it was declared with, when it's the whole initial value of a `data`. */
  declared: PopType | undefined;
}

interface Binding {
  name: string;
  type: Type;
}

class Scope {
  readonly vars = new Map<string, Binding>();
  /** Variables declared here in Pop that were declared before the branch instead. */
  readonly hoisted = new Set<string>();
  constructor(readonly parent: Scope | undefined) {}
  lookup(name: string): Binding | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
}

/** One part or function being written, or the top level. */
interface Body {
  owner: string | undefined;
  genes: string[];
  /** Names declared here, which nothing else in it may reuse. */
  names: Set<string>;
  /** Pop names assigned somewhere in it, which can't be genes. */
  assigned: Set<string>;
  /** In a colour space builder: the position asked for, and the colour space so far. */
  sampler?: { t: string; from: string; at: string; stops: string };
  /** Colour spaces built here, among the drawing, which its later colours come from. */
  spaces?: Map<number, { builder: string; args: string[] }>;
}

const DEG = 180 / Math.PI;

/** Pop's named constants, as GenoCode. */
const CONSTANTS: Record<string, Code> = {
  pi: { code: "pi", type: "num" },
  sqrt2: { code: "sqrt2", type: "num" },
  sqrt3: { code: "sqrt3", type: "num" },
  ln2: { code: "ln2", type: "num" },
  gm: { code: "golden", type: "num" },
  x_axis: { code: "x_axis", type: "vec3" },
  y_axis: { code: "y_axis", type: "vec3" },
  z_axis: { code: "z_axis", type: "vec3" },
  prim_first: { code: "0", type: "int" },
  prim_last: { code: "5", type: "int" },
  prim_count: { code: "6", type: "int" },
  colour_white: { code: "white", type: "colour" },
  colour_black: { code: "black", type: "colour" },
  colour_red: { code: "red", type: "colour" },
  colour_green: { code: "green", type: "colour" },
  colour_blue: { code: "blue", type: "colour" },
  colour_yellow: { code: "yellow", type: "colour" },
  colour_cyan: { code: "cyan", type: "colour" },
  colour_magenta: { code: "magenta", type: "colour" },
  colour_dark: { code: "hsv(0, 0, 0.25)", type: "colour" },
  colour_pastel: { code: "hsv(0, 0.3, 1)", type: "colour" },
  colour_transparent: { code: "transparent", type: "colour" },
};
for (const s of SHAPES) CONSTANTS[`prim_${s}`] = { code: s, type: "unknown" };

/** Turns the way Pop does: by the right-hand rule, whether or not the turtle is mirrored. */
const POP_TURN = [
  "",
  "// Pop turned the same way whether or not the turtle was mirrored; GenoCode turns the mirror",
  "// image. This keeps the original's look.",
  "function pop_turn(angle) {",
  "  if turtle.mirrored {",
  "    return -angle",
  "  }",
  "  return angle",
  "}",
];

/** Blends colours as Pop's colour spaces did: every channel, hue too, in a straight line. */
const POP_BLEND = [
  "",
  "// Pop's colour spaces blended hue in a straight line, not the short way round.",
  "function pop_blend(a, b, amount) {",
  "  let k = clamp(amount, 0, 1)",
  "  return hsv(mix(a.hue, b.hue, k), mix(a.sat, b.sat, k), mix(a.val, b.val, k))",
  "}",
];

const COMPARISONS: Record<string, string> = {
  eq: "==",
  ieq: "==",
  beq: "==",
  v3eq: "==",
  ceq: "==",
  less: "<",
  iless: "<",
  more: ">",
  imore: ">",
  lesseq: "<=",
  ilesseq: "<=",
  moreeq: ">=",
  imoreeq: ">=",
};

/** Turtle commands, with how their argument is translated. */
const COMMANDS: Record<string, { word: string; angle: boolean }> = {
  forward: { word: "forward", angle: false },
  move: { word: "move", angle: false },
  pitch: { word: "pitch", angle: true },
  yaw: { word: "yaw", angle: true },
  roll: { word: "roll", angle: true },
  scale: { word: "grow", angle: false },
  uscale: { word: "grow", angle: false },
};

/** A number to six significant figures: as exactly as Pop wrote it. */
const number = (x: number): string => {
  const n = Number(x.toPrecision(6));
  return Object.is(n, -0) ? "0" : String(n);
};

/** A number written in the code, exactly as Pop wrote it. */
const exact = (x: number): string => (x < 0 ? `(${x})` : String(x));

/** A worked-out angle or amount: whole numbers stay whole, others keep four decimals. */
const folded = (x: number): string => {
  const n = Number(x.toFixed(4));
  return n < 0 ? `(${n})` : String(Object.is(n, -0) ? 0 : n);
};

/** The value of an expression made only of plain numbers and π, if it is one. */
function numeric(e: PopExpr): number | undefined {
  switch (e.k) {
    case "const":
      return typeof e.value === "number" && !isGene(e) ? e.value : undefined;
    case "var":
      return e.name === "pi" ? Math.PI : undefined;
    case "neg": {
      const a = numeric(e.a);
      return a === undefined ? undefined : -a;
    }
    case "bin": {
      const a = numeric(e.a);
      const b = numeric(e.b);
      if (a === undefined || b === undefined) return undefined;
      switch (e.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b === 0 ? undefined : a / b;
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}
/** A gene's value as the original had it (to six significant figures), within lo..hi. */
const within = (x: number, lo: number, hi: number): string => {
  const n = clamp(Number(clamp(x, lo, hi).toPrecision(6)), lo, hi);
  return Object.is(n, -0) ? "0" : String(n);
};
const hueOf = (h: number): string => String(Number((h * 360).toFixed(3)));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Translates a population: its first member's program, with the others as variants. */
export function translatePopulation(
  creatureName: string,
  genomes: readonly string[],
  source: string,
): Translation {
  if (genomes.length === 0) return { text: "", warnings: ["There are no genomes in the file."] };
  return new Translator(creatureName, genomes, source).run();
}

class Translator {
  private readonly warnings: string[] = [];
  private readonly base: PopProgram;
  private readonly baseGenes: PopConst[];
  /** Genes by the node they're written in, once they've been met. */
  private readonly genes = new Map<PopConst, Gene>();
  /** Names used at the top level: parts, functions, globals and top-level genes. */
  private readonly top = new Set<string>();
  private readonly parts = new Map<string, string>();
  /**
   * Colour space builders: functions that fill the colour space numbered by their first
   * parameter (Pop's `init_cspace` and `extend_cspace`), and draw nothing. Each becomes a function
   * giving the colour at a position, as Pop's `cspace(index, t)` does.
   */
  private readonly builders = new Set<string>();
  /** Which builder fills each colour space, and the globals holding its other arguments. */
  private readonly spaces = new Map<number, { builder: string; args: string[] }>();
  /** The globals that hold builders' arguments, declared at the top. */
  private readonly spaceGlobals: string[] = [];
  /** Builders made for colour spaces that are built among drawing, written after the parts. */
  private readonly madeBuilders: PopFunction[] = [];
  /** Pop names assigned anywhere in the program. */
  private assignedAnywhere = new Set<string>();
  private readonly todos = new Set<string>();
  /** Helpers the translation uses. */
  private popTurn = false;
  private popBlend = false;
  private popCspace = false;

  constructor(
    private readonly creatureName: string,
    private readonly genomes: readonly string[],
    private readonly source: string,
  ) {
    this.base = parsePop(genomes[0]!);
    this.baseGenes = genesOf(this.base);
  }

  run(): Translation {
    for (const f of this.base.functions) {
      if (f.name === "main") continue;
      this.parts.set(f.name, this.allocate(f.name, undefined));
      if (isBuilder(f)) this.builders.add(f.name);
    }

    for (const helper of ["pop_turn", "pop_blend", "pop_cspace"]) this.top.add(helper);

    // Which builder fills each colour space, so uses can come before the builder is called.
    const visit = (list: PopStmt[] | undefined): void => {
      for (const st of list ?? []) {
        if (st.k === "expr" && st.e.k === "call" && this.builders.has(st.e.name)) {
          const index = st.e.args[0];
          if (index?.k !== "const" || typeof index.value !== "number") continue;
          const builder = st.e.name;
          const f = this.base.functions.find((g) => g.name === builder)!;
          const known = this.spaces.get(index.value);
          if (known && known.builder !== builder) {
            this.warn(
              `Colour space ${index.value} is filled by more than one builder; the first is used.`,
            );
            continue;
          }
          if (known) continue;
          const args = f.params.slice(1).map((p) => {
            const name = this.allocate(`cspace_${index.value}_${p.name}`, undefined);
            this.spaceGlobals.push(`let ${name} = ${defaultValue(p.type)}`);
            return name;
          });
          this.spaces.set(index.value, { builder, args });
        }
        if (st.k === "if") {
          visit(st.then);
          visit(st.els);
        }
        if (st.k === "while" || st.k === "for") visit(st.body);
      }
    };
    for (const f of this.base.functions) visit(f.body);

    // Globals can be assigned from any function, so look for assignments everywhere.
    const topBody = this.body(undefined, [
      ...this.base.globals,
      ...this.base.functions.flatMap((f) => f.body),
    ]);
    this.assignedAnywhere = topBody.assigned;
    const globalScope = new Scope(undefined);
    const lines: string[] = [];
    this.statements(this.base.globals, globalScope, topBody, lines);
    const main = this.base.functions.find((f) => f.name === "main");
    if (!main) this.warn("The program has no `main`, so nothing at the top level draws.");
    else this.statements(main.body, new Scope(globalScope), topBody, lines);

    const definitions: string[] = [];
    for (const f of this.base.functions) {
      if (f.name === "main") continue;
      definitions.push("", ...this.definition(f, globalScope));
    }
    // Found while writing the parts above.
    for (const f of this.madeBuilders) {
      definitions.push("", ...this.definition(f, globalScope));
    }

    let creature = this.creatureName.replace(/\W/g, "_");
    if (!/^[A-Za-z_]/.test(creature)) creature = `_${creature}`;
    const out = [
      `creature ${creature}`,
      `// Translated from ${this.source} by genie translate: ${this.genomes.length} member${this.genomes.length === 1 ? "" : "s"}.`,
      "",
      ...topBody.genes,
      "",
      ...this.spaceGlobals,
      ...lines,
      ...definitions,
      ...this.variants(),
      ...(this.popTurn ? POP_TURN : []),
      ...(this.popBlend ? POP_BLEND : []),
      ...(this.popCspace ? this.cspaceDispatcher() : []),
    ];
    let text = mergeReshapes(out).join("\n") + "\n";
    const formatted = formatText(text);
    if (formatted.text !== undefined) text = formatted.text;
    else this.warn("The result couldn't be laid out by the formatter: it has syntax errors.");
    return { text, warnings: [...this.todos, ...this.warnings] };
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** A TODO comment in the code, and a warning. */
  private todo(lines: string[], message: string): void {
    lines.push(`// TODO: ${message}`);
    this.todos.add(`TODO: ${message}`);
  }

  // ---------- names ----------

  /** A GenoCode name for a Pop name, unused at the top level and in `body`. */
  private allocate(wanted: string, body: Body | undefined, numbered = false): string {
    let base = wanted.replace(/[^A-Za-z0-9_]/g, "_");
    if (/^[0-9]/.test(base)) base = `_${base}`;
    if (KEYWORDS.has(base) || isBuiltinName(base) || base === "side") base = `${base}_`;
    const taken = (n: string) => this.top.has(n) || body?.names.has(n) === true;
    let k = numbered ? 1 : 2;
    let name = numbered ? `${base}_1` : base;
    while (taken(name)) name = `${base}_${k++ + (numbered ? 1 : 0)}`;
    if (body?.owner === undefined) this.top.add(name);
    body?.names.add(name);
    return name;
  }

  private body(owner: string | undefined, stmts: PopStmt[]): Body {
    const assigned = new Set<string>();
    const visit = (list: PopStmt[] | undefined): void => {
      for (const s of list ?? []) {
        if (s.k === "assign") assigned.add(s.name);
        if (s.k === "for") assigned.add(s.name);
        if (s.k === "if") {
          visit(s.then);
          visit(s.els);
        }
        if (s.k === "while" || s.k === "for") visit(s.body);
      }
    };
    visit(stmts);
    return { owner, genes: [], names: new Set(), assigned };
  }

  // ---------- genes ----------

  /** The gene a node is, declared in `body` the first time it's met. `numbered` genes are named after where they're used. */
  private gene(
    node: PopConst,
    wanted: string,
    body: Body,
    declared?: PopType,
    numbered = false,
  ): Code {
    let g = this.genes.get(node);
    if (!g) {
      g = { name: this.allocate(wanted, body, numbered), owner: body.owner, node, declared };
      this.genes.set(node, g);
      const decl = this.geneDeclaration(g);
      if (decl === undefined) return this.literal(node);
      body.genes.push(decl);
    } else if (this.geneDeclaration(g) === undefined) {
      return this.literal(node);
    }
    return { code: g.name, type: this.geneType(g) };
  }

  private geneType(g: Gene): Type {
    const v = g.node.value;
    if (typeof v === "boolean") return "bool";
    if (Array.isArray(v)) return v.length === 4 ? "colour" : "vec3";
    return this.isWholeGene(g) ? "int" : "num";
  }

  /** Every member's value of the gene at the same place, the first member's first. */
  private memberValues(g: Gene): PopConst["value"][] {
    const index = this.baseGenes.indexOf(g.node);
    return this.members().map((m) => m.genes[index]?.value ?? g.node.value);
  }

  private isWholeGene(g: Gene): boolean {
    if (g.declared === "int") return true;
    if (g.declared !== undefined) return false;
    const whole = (v: unknown) => typeof v === "number" && Number.isInteger(v);
    const { lo, hi } = this.range(g);
    return g.node.isInt && whole(lo[0]) && whole(hi[0]) && this.memberValues(g).every(whole);
  }

  /** `gene name = v in min..max`, or undefined for a "gene" whose range has no room to move. */
  private readonly ranges = new Map<Gene, { lo: number[]; hi: number[] }>();

  /**
   * A gene's range, channel by channel: its bounds in order (Pop accepts `[v]:[4]:[-4]`), widened
   * to take in every member's value, which Pop didn't always keep within the range.
   */
  private range(g: Gene): { lo: number[]; hi: number[] } {
    let r = this.ranges.get(g);
    if (r) return r;
    const list = (v: unknown) => (Array.isArray(v) ? (v as number[]) : [v as number]);
    const [a, b] = [list(g.node.min), list(g.node.max)];
    const lo = a.map((x, k) => Math.min(x, b[k]!));
    const hi = a.map((x, k) => Math.max(x, b[k]!));
    let widened = false;
    for (const v of this.memberValues(g)) {
      list(v).forEach((x, k) => {
        if (x < lo[k]!) [lo[k], widened] = [x, true];
        if (x > hi[k]!) [hi[k], widened] = [x, true];
      });
    }
    if (widened) {
      this.warn(`Gene \`${this.fullName(g)}\`'s range is widened to take in every member's value.`);
    }
    r = { lo, hi };
    this.ranges.set(g, r);
    return r;
  }

  /** `gene name = v in min..max`, or undefined for a "gene" whose value can't change. */
  private geneDeclaration(g: Gene): string | undefined {
    const { value } = g.node;
    const head = `gene ${g.name} = `;
    if (typeof value === "boolean") return `${head}${value}`;
    const { lo, hi } = this.range(g);
    if (lo.every((x, k) => x === hi[k])) return undefined;
    if (typeof value === "number") {
      const [min, max] = [lo[0]!, hi[0]!];
      if (min > 0 && max / min > 10) {
        this.warn(
          `Gene \`${this.fullName(g)}\` spans more than 10×: it may work better as \`log\`.`,
        );
      }
      const whole = this.isWholeGene(g) ? " step 1" : "";
      return `${head}${this.geneValue(g, value)} in ${exact(min)}..${exact(max)}${whole}`;
    }
    if (value.length === 4) {
      const colour = (c: number[]) => `hsv(${hueOf(c[0]!)}, ${number(c[1]!)}, ${number(c[2]!)})`;
      return `${head}${this.geneValue(g, value)} in ${colour(lo)}..${colour(hi)}`;
    }
    const vec = (v: number[]) => `(${[0, 1, 2].map((k) => number(v[k] ?? 0)).join(", ")})`;
    return `${head}${this.geneValue(g, value)} in ${vec(lo)}..${vec(hi)}`;
  }

  /** A gene's value as GenoCode, within the gene's range. */
  private geneValue(g: Gene, value: PopConst["value"]): string {
    if (typeof value === "boolean") return String(value);
    const { lo, hi } = this.range(g);
    if (typeof value === "number") {
      if (this.isWholeGene(g)) return String(clamp(Math.round(value), lo[0]!, hi[0]!));
      return within(value, lo[0]!, hi[0]!);
    }
    const channel = (k: number) => within(value[k] ?? 0, lo[k] ?? 0, hi[k] ?? 0);
    if (value.length === 4) {
      // Pop's alpha is ignored: its shapes are always drawn solid.
      // A hue of 1 is 360°, which GenoCode keeps as 0°; just under it keeps it at the top, where
      // Pop's straight-line blends expect it.
      const h = Math.min(
        Number(clamp(value[0]! * 360, lo[0]! * 360, hi[0]! * 360).toFixed(3)),
        359.999,
      );
      return `hsv(${String(h)}, ${channel(1)}, ${channel(2)})`;
    }
    return `(${[0, 1, 2].map(channel).join(", ")})`;
  }

  private fullName(g: Gene): string {
    return g.owner === undefined ? g.name : `${g.owner}.${g.name}`;
  }

  // ---------- variants ----------

  private membersCache: { genes: PopConst[]; same: boolean }[] | undefined;

  /** Every member's genes, lined up with the first member's. */
  private members(): { genes: PopConst[]; same: boolean }[] {
    if (this.membersCache) return this.membersCache;
    // The program with its genes' values left out.
    const shape = (p: PopProgram) =>
      JSON.stringify(p, (_, v: unknown) =>
        v !== null && typeof v === "object" && isGene(v as PopExpr) ? "gene" : v,
      );
    const baseShape = shape(this.base);
    this.membersCache = this.genomes.map((text, k) => {
      if (k === 0) return { genes: this.baseGenes, same: true };
      try {
        const p = parsePop(text);
        return { genes: genesOf(p), same: shape(p) === baseShape };
      } catch {
        return { genes: [], same: false };
      }
    });
    return this.membersCache;
  }

  private variants(): string[] {
    const out: string[] = [];
    this.members().forEach((m, k) => {
      if (k === 0) return;
      const fits =
        m.genes.length === this.baseGenes.length &&
        m.genes.every((x, i) => kindOf(x.value) === kindOf(this.baseGenes[i]!.value));
      if (!fits) {
        this.warn(`Member ${k + 1}'s genes don't match the first member's, so it's left out.`);
        return;
      }
      if (!m.same) {
        this.warn(
          `Member ${k + 1}'s program differs from the first member's beyond its genes; only its gene values are kept.`,
        );
      }
      const settings: string[] = [];
      for (const g of this.genes.values()) {
        if (this.geneDeclaration(g) === undefined) continue;
        const own = this.geneValue(g, g.node.value);
        const theirs = this.geneValue(g, m.genes[this.baseGenes.indexOf(g.node)]!.value);
        if (theirs !== own) settings.push(`  ${this.fullName(g)} = ${theirs}`);
      }
      out.push("", `variant member_${k + 1} {`, ...settings, "}");
    });
    return out;
  }

  // ---------- definitions ----------

  private definition(f: PopFunction, globals: Scope): string[] {
    const name = this.parts.get(f.name)!;
    const body = this.body(name, f.body);
    const scope = new Scope(globals);
    const builder = this.builders.has(f.name);
    const params = (builder ? f.params.slice(1) : f.params).map((p) => {
      const n = this.allocate(p.name, body);
      scope.vars.set(p.name, { name: n, type: popType(p.type) });
      return n;
    });
    const lines: string[] = [];
    if (builder) {
      // The colour space is built as Pop builds it, stopping at the position asked for.
      body.sampler = {
        t: this.allocate("t", body),
        from: this.allocate("colour_so_far", body),
        at: this.allocate("position_so_far", body),
        stops: this.allocate("stops_so_far", body),
      };
      params.push(body.sampler.t);
      lines.push(
        `let ${body.sampler.from} = white`,
        `let ${body.sampler.at} = 0`,
        `let ${body.sampler.stops} = 0`,
      );
      this.statements(f.body, scope, body, lines);
      lines.push(`return ${body.sampler.from}`);
    } else {
      if (f.ret !== "void") this.warn(`\`${f.name}\` returns a value; it's written as a part.`);
      this.statements(f.body, scope, body, lines);
    }
    const header = builder
      ? `function ${name}(${params.join(", ")})`
      : params.length > 0
        ? `part ${name}(${params.join(", ")})`
        : `part ${name}`;
    return [`${header} {`, ...body.genes, ...lines, "}"];
  }

  // ---------- statements ----------

  private statements(list: PopStmt[], scope: Scope, body: Body, out: string[]): void {
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      if (isCall(s, "push")) {
        const end = matchingPop(list, i);
        if (end < 0) {
          this.todo(out, "`push()` without a matching `pop()` in the same block.");
          continue;
        }
        const inner = list.slice(i + 1, end);
        const branchScope = new Scope(scope);
        // Pop's push() and pop() don't end variables, but a branch does: declare those used
        // after it before it.
        const later = list.slice(end + 1);
        for (const d of inner) {
          if (d.k !== "data" || !mentions(later, d.name)) continue;
          const type = popType(d.type);
          const name = this.allocate(d.name, body);
          scope.vars.set(d.name, { name, type });
          branchScope.hoisted.add(d.name);
          out.push(`let ${name} = ${defaultValue(d.type)}`);
        }
        this.branch(inner, branchScope, body, out);
        i = end;
        continue;
      }
      if (isCall(s, "pop")) {
        this.todo(out, "`pop()` without a matching `push()` in the same block.");
        continue;
      }
      const built = body.sampler ? undefined : builtHere(list, i);
      if (built && this.buildHere(built, scope, body)) {
        i += built.calls.length - 1;
        continue;
      }
      this.statement(s, scope, body, out);
    }
  }

  /** `push(); … pop();` is a branch, and `push(); egg_…; lay(); pop();` lays one reshaped shape. */
  private branch(inner: PopStmt[], scope: Scope, body: Body, out: string[]): void {
    const last = inner[inner.length - 1];
    const eggs = inner.slice(0, -1);
    if (
      last &&
      isCall(last, "lay") &&
      eggs.length > 0 &&
      eggs.every((s) => s.k === "expr" && s.e.k === "call" && s.e.name.startsWith("egg_"))
    ) {
      const commands = eggs.map((s) =>
        this.eggCommand(s as { k: "expr"; e: PopExpr }, scope, body),
      );
      if (commands.every((c) => c !== undefined)) {
        out.push(`lay { ${commands.join("; ")} }`);
        return;
      }
    }
    out.push("branch {");
    this.statements(inner, scope, body, out);
    out.push("}");
  }

  private eggCommand(s: { k: "expr"; e: PopExpr }, scope: Scope, body: Body): string | undefined {
    const call = s.e as Extract<PopExpr, { k: "call" }>;
    return this.command(call.name.slice(4), call.args, scope, body, true);
  }

  /**
   * A turtle command, or undefined if it isn't one. Pop turns by the right-hand rule even when the
   * turtle is mirrored, where GenoCode turns the mirror image (LANGUAGE.md section 11.3), so the
   * turtle's turns go through `pop_turn`, which reverses them while it's mirrored. Turns of the
   * shape transform (Pop's egg) are left as they are: it's rarely mirrored when it turns, and
   * there's no reading whether it is.
   */
  private command(
    name: string,
    args: PopExpr[],
    scope: Scope,
    body: Body,
    egg = false,
  ): string | undefined {
    const turn = (angle: string) => {
      if (egg) return angle;
      this.popTurn = true;
      return `pop_turn(${angle})`;
    };
    const c = COMMANDS[name];
    if (c?.angle) return `${c.word} ${turn(this.degrees(args[0]!, scope, body, name).code)}`;
    if (c) return `${c.word} ${this.expr(args[0]!, scope, body, name).code}`;
    if (name === "rotate") {
      const axis = this.expr(args[0]!, scope, body, "rotate");
      return `rotate ${turn(this.degrees(args[1]!, scope, body, "rotate").code)} around ${axis.code}`;
    }
    return undefined;
  }

  private statement(s: PopStmt, scope: Scope, body: Body, out: string[]): void {
    switch (s.k) {
      case "data": {
        if (scope.hoisted.has(s.name)) {
          const target = scope.lookup(s.name)!;
          const value = s.init
            ? this.expr(s.init, scope, body, s.name)
            : { code: defaultValue(s.type), type: target.type };
          out.push(`${target.name} = ${toType(value, target.type)}`);
          return;
        }
        if (s.init && isGene(s.init) && !body.assigned.has(s.name)) {
          const g = this.gene(s.init, s.name, body, s.type);
          scope.vars.set(s.name, { name: g.code, type: g.type });
          return;
        }
        const type = popType(s.type);
        const name = this.allocate(s.name, body);
        let value: Code;
        if (s.init && isGene(s.init)) {
          value = this.gene(s.init, `${s.name}_start`, body, s.type);
        } else if (s.init) {
          value = this.expr(s.init, scope, body, s.name);
        } else {
          value = { code: defaultValue(s.type), type };
        }
        scope.vars.set(s.name, { name, type });
        out.push(`let ${name} = ${toType(value, type)}`);
        return;
      }
      case "assign": {
        const target = scope.lookup(s.name);
        if (!target) {
          this.todo(out, `\`${s.name}\` is assigned but never declared.`);
          return;
        }
        const value = this.expr(s.value, scope, body, s.name);
        out.push(`${target.name} = ${toType(value, target.type)}`);
        return;
      }
      case "expr":
        this.callStatement(s.e, scope, body, out);
        return;
      case "if": {
        out.push(`if ${this.expr(s.cond, scope, body, "if").code} {`);
        this.statements(s.then, new Scope(scope), body, out);
        let els = s.els;
        while (els) {
          const only = els.length === 1 ? els[0]! : undefined;
          if (only?.k === "if") {
            out.push(`} else if ${this.expr(only.cond, scope, body, "if").code} {`);
            this.statements(only.then, new Scope(scope), body, out);
            els = only.els;
          } else {
            out.push("} else {");
            this.statements(els, new Scope(scope), body, out);
            els = undefined;
          }
        }
        out.push("}");
        return;
      }
      case "while":
        out.push(`while ${this.expr(s.cond, scope, body, "while").code} {`);
        this.statements(s.body, new Scope(scope), body, out);
        out.push("}");
        return;
      case "for":
        this.forLoop(s, scope, body, out);
        return;
      case "return":
        if (s.value) this.warn("A `return` with a value is written without it.");
        out.push("return");
        return;
    }
  }

  /**
   * `for( int i = a; iless(i, b); (i + s) )` becomes `for i from a to b - 1 by s`, and the forms
   * that don't fit become a `while` loop.
   */
  private forLoop(
    s: Extract<PopStmt, { k: "for" }>,
    scope: Scope,
    body: Body,
    out: string[],
  ): void {
    const inner = new Scope(scope);
    const type = s.type ? popType(s.type) : (scope.lookup(s.name)?.type ?? "num");
    const cond = s.cond.k === "call" ? s.cond : undefined;
    const op = cond ? COMPARISONS[cond.name] : undefined;
    const step = stepOf(s.step, s.name);
    const assignedInside = assigns(s.body, s.name);
    const fits =
      s.type !== undefined &&
      cond !== undefined &&
      cond.args[0]?.k === "var" &&
      cond.args[0].name === s.name &&
      (op === "<=" || (op === "<" && type === "int")) &&
      step !== undefined &&
      !assignedInside;
    if (fits) {
      const name = this.allocate(s.name, body);
      const from = this.expr(s.init, scope, body, s.name).code;
      const limit = this.expr(cond.args[1]!, scope, body, s.name).code;
      const by = this.expr(step, scope, body, s.name).code;
      inner.vars.set(s.name, { name, type });
      const to = op === "<" ? `(${limit}) - 1` : limit;
      out.push(`for ${name} from ${from} to ${to}${by === "1" ? "" : ` by ${by}`} {`);
      this.statements(s.body, inner, body, out);
      out.push("}");
      return;
    }
    let target = s.type === undefined ? scope.lookup(s.name) : undefined;
    if (!target) {
      target = { name: this.allocate(s.name, body), type };
      out.push(`let ${target.name} = ${toType(this.expr(s.init, scope, body, s.name), type)}`);
    } else {
      out.push(`${target.name} = ${toType(this.expr(s.init, scope, body, s.name), type)}`);
    }
    inner.vars.set(s.name, target);
    out.push(`while ${this.expr(s.cond, inner, body, "while").code} {`);
    this.statements(s.body, new Scope(inner), body, out);
    out.push(`${target.name} = ${toType(this.expr(s.step, inner, body, s.name), type)}`);
    out.push("}");
  }

  private callStatement(e: PopExpr, scope: Scope, body: Body, out: string[]): void {
    if (e.k !== "call") {
      this.todo(out, "an expression on its own, which does nothing.");
      return;
    }
    const { name, args } = e;
    const command = this.command(name, args, scope, body);
    if (command !== undefined) {
      out.push(command);
      return;
    }
    if (name.startsWith("egg_")) {
      const inner = this.command(name.slice(4), args, scope, body, true);
      if (inner !== undefined) {
        out.push(`reshape { ${inner} }`);
        return;
      }
    }
    const arg = (k: number, context = name) => this.expr(args[k]!, scope, body, context);
    switch (name) {
      case "lay":
        out.push("lay");
        return;
      case "set_prim": {
        const n = args[0]!;
        if (n.k === "const" && typeof n.value === "number" && !isGene(n)) {
          out.push(`shape ${SHAPES[Math.abs(Math.trunc(n.value)) % 6]}`);
        } else {
          // Pop drops the fraction where GenoCode rounds.
          out.push(`shape floor(abs(${arg(0, "shape").code}))`);
        }
        return;
      }
      case "set_colour":
        out.push(`colour ${arg(0, "colour").code}`);
        return;
      // Pop's shine runs from 0 to 3 and its sharpness from 0 to 100; GenoCode's from 0 to 1.
      case "set_shine":
        out.push(`shine ${this.scaled(args[0]!, 3, scope, body, "shine")}`);
        return;
      case "set_sharp":
        out.push(`sharpness ${this.scaled(args[0]!, 100, scope, body, "sharpness")}`);
        return;
      case "set_texture": {
        const n = args[0]!;
        if (n.k === "const" && n.value === -1) {
          out.push("texture none");
          return;
        }
        this.todo(
          out,
          `choose a texture: the original used its texture slot ${n.k === "const" ? String(n.value) : "(computed)"}.`,
        );
        return;
      }
      case "print":
        out.push(`print(${args.map((_, k) => arg(k).code).join(", ")})`);
        return;
      case "init_cspace":
      case "extend_cspace": {
        const sampler = body.sampler;
        if (!sampler) {
          this.todo(
            out,
            `build this colour space by hand: \`${name}\` here is mixed with drawing.`,
          );
          return;
        }
        if (name === "init_cspace") {
          out.push(
            `${sampler.from} = ${arg(1, "colour").code}`,
            `${sampler.at} = 0`,
            `${sampler.stops} = 1`,
          );
          return;
        }
        // Pop adds stops while the colour space is below 1, up to 17 of them, and blends hue in
        // a straight line.
        this.popBlend = true;
        const step = arg(1, "delta").code;
        const colour = arg(2, "colour").code;
        out.push(
          `if ${sampler.at} < 1 and ${sampler.stops} < 17 {`,
          `${sampler.stops} = ${sampler.stops} + 1`,
          `if ${sampler.t} <= ${sampler.at} + ${step} {`,
          `return pop_blend(${sampler.from}, ${colour}, (${sampler.t} - ${sampler.at}) / max(${step}, 0.000001))`,
          "}",
          `${sampler.from} = ${colour}`,
          `${sampler.at} = ${sampler.at} + ${step}`,
          "}",
        );
        return;
      }
    }
    if (this.builders.has(name)) {
      // Building a colour space: its colours come from the builder when they're asked for, so
      // all that's left to do here is keep its other arguments.
      const index = args[0]!;
      const space =
        index.k === "const" && typeof index.value === "number"
          ? this.spaces.get(index.value)
          : undefined;
      if (!space || space.builder !== name) {
        this.todo(out, `\`${name}\` builds a colour space chosen while running.`);
        return;
      }
      space.args.forEach((g, k) => out.push(`${g} = ${arg(k + 1).code}`));
      return;
    }
    const part = this.parts.get(name);
    if (part !== undefined) {
      out.push(args.length > 0 ? `${part}(${args.map((_, k) => arg(k).code).join(", ")})` : part);
      return;
    }
    this.todo(out, `\`${name}(…)\` has no GenoCode translation.`);
  }

  // ---------- colour spaces ----------

  /**
   * A colour space built among drawing, as `init_cspace(0, a); extend_cspace(0, step, b)`: it
   * becomes a builder of its own, and the colours this part takes from it later come from that.
   * Only when nothing it's built from changes, so the colours can be worked out where they're
   * used; false otherwise.
   */
  private buildHere(built: BuiltHere, scope: Scope, body: Body): boolean {
    const values = built.calls.flatMap((c) => c.args.slice(1));
    if (
      values.some((e) =>
        namesIn(e).some((n) => body.assigned.has(n) || this.assignedAnywhere.has(n)),
      )
    ) {
      return false;
    }
    const key = `@${body.owner ?? ""}:${built.index}`;
    if (!this.parts.has(key)) {
      const wanted = `${body.owner ?? "main"}_colours${built.index === 0 ? "" : `_${built.index}`}`;
      this.parts.set(key, this.allocate(wanted, undefined));
      this.builders.add(key);
      const index: PopExpr = { k: "var", name: "index" };
      const params: PopFunction["params"] = [{ type: "int", name: "index" }];
      const stmts: PopStmt[] = built.calls.map((c, k) => {
        const names = k === 0 ? [`colour_0`] : [`step_${k}`, `colour_${k}`];
        params.push(
          ...names.map((name) => ({
            type: name.startsWith("step") ? ("num" as const) : ("colour" as const),
            name,
          })),
        );
        return {
          k: "expr",
          e: {
            k: "call",
            name: c.name,
            args: [index, ...names.map((name): PopExpr => ({ k: "var", name }))],
          },
        };
      });
      this.madeBuilders.push({ name: key, ret: "void", params, body: stmts });
    }
    const args = built.calls.flatMap((c, k) =>
      (k === 0 ? ["colour"] : ["delta", "colour"]).map(
        (context, j) => this.expr(c.args[j + 1]!, scope, body, context).code,
      ),
    );
    (body.spaces ??= new Map()).set(built.index, { builder: key, args });
    return true;
  }

  private sample(space: { builder: string; args: string[] }, t: string): string {
    return `${this.parts.get(space.builder)}(${[...space.args, t].join(", ")})`;
  }

  /** `pop_cspace(i, t)`: the colour at `t` in colour space `i`, for spaces chosen while running. */
  private cspaceDispatcher(): string[] {
    const lines = ["", "function pop_cspace(index, t) {"];
    for (const [k, space] of [...this.spaces].sort((a, b) => a[0] - b[0])) {
      lines.push(`if index == ${k} {`, `return ${this.sample(space, "t")}`, "}");
    }
    lines.push("return white", "}");
    return lines;
  }

  // ---------- expressions ----------

  private literal(c: PopConst): Code {
    const v = c.value;
    if (typeof v === "boolean") return { code: String(v), type: "bool" };
    if (typeof v === "number") return { code: exact(v), type: c.isInt ? "int" : "num" };
    if (v.length === 4)
      return { code: `hsv(${hueOf(v[0]!)}, ${number(v[1]!)}, ${number(v[2]!)})`, type: "colour" };
    return { code: `(${[0, 1, 2].map((k) => number(v[k] ?? 0)).join(", ")})`, type: "vec3" };
  }

  /** An angle in radians, as degrees. */
  private degrees(e: PopExpr, scope: Scope, body: Body, context: string): Code {
    if (e.k === "call" && e.name === "dtor") return this.expr(e.args[0]!, scope, body, context);
    const n = numeric(e);
    if (n !== undefined) return { code: folded(n * DEG), type: "num" };
    if (e.k === "neg") {
      const inner = this.degrees(e.a, scope, body, context);
      return { code: `(-${inner.code})`, type: "num" };
    }
    return { code: `degrees(${this.expr(e, scope, body, context).code})`, type: "num" };
  }

  /** An amount divided by `by`, worked out when it's a plain number. */
  private scaled(e: PopExpr, by: number, scope: Scope, body: Body, context: string): string {
    const n = numeric(e);
    if (n !== undefined) return folded(n / by);
    return `(${this.expr(e, scope, body, context).code} / ${by})`;
  }

  /** A Pop hue, 0 to 1, as degrees. */
  private hue(e: PopExpr, scope: Scope, body: Body, context: string): string {
    const n = numeric(e);
    if (n !== undefined) return hueOf(n);
    return `(${this.expr(e, scope, body, context).code} * 360)`;
  }

  private expr(e: PopExpr, scope: Scope, body: Body, context: string): Code {
    switch (e.k) {
      case "const":
        return isGene(e) ? this.gene(e, context, body, undefined, true) : this.literal(e);
      case "var": {
        const b = scope.lookup(e.name);
        if (b) return { code: b.name, type: b.type };
        const c = CONSTANTS[e.name];
        if (c) return c;
        this.warn(`\`${e.name}\` is used but never declared.`);
        return { code: e.name, type: "unknown" };
      }
      case "neg": {
        const a = this.expr(e.a, scope, body, context);
        return { code: `(-${a.code})`, type: a.type };
      }
      case "not":
        return { code: `(not ${this.expr(e.a, scope, body, context).code})`, type: "bool" };
      case "logic": {
        const a = this.expr(e.a, scope, body, context).code;
        const b = this.expr(e.b, scope, body, context).code;
        return { code: `(${a} ${e.op === "&" ? "and" : "or"} ${b})`, type: "bool" };
      }
      case "bin": {
        const a = this.expr(e.a, scope, body, context);
        const b = this.expr(e.b, scope, body, context);
        const ints = a.type === "int" && b.type === "int";
        if (e.op === "/" && ints) return { code: `floor(${a.code} / ${b.code})`, type: "int" };
        const type: Type = ints ? "int" : a.type === "vec3" || b.type === "vec3" ? "vec3" : "num";
        return { code: `(${a.code} ${e.op} ${b.code})`, type };
      }
      case "call":
        return this.call(e.name, e.args, scope, body);
    }
  }

  private call(name: string, args: PopExpr[], scope: Scope, body: Body): Code {
    const arg = (k: number) => this.expr(args[k]!, scope, body, name);
    const all = () => args.map((_, k) => arg(k).code).join(", ");
    const op = COMPARISONS[name];
    if (op) return { code: `(${arg(0).code} ${op} ${arg(1).code})`, type: "bool" };
    switch (name) {
      case "xor":
        return { code: `(${arg(0).code} != ${arg(1).code})`, type: "bool" };
      case "iton":
        return { code: arg(0).code, type: "num" };
      case "ntoi":
        return { code: `floor(${arg(0).code})`, type: "int" };
      case "sin":
      case "cos":
      case "tan":
        return { code: `${name}(${this.degrees(args[0]!, scope, body, name).code})`, type: "num" };
      case "asin":
      case "acos":
      case "atan":
        return { code: `radians(${name}(${arg(0).code}))`, type: "num" };
      case "dtor":
        return { code: `radians(${arg(0).code})`, type: "num" };
      case "rtod":
        return { code: `degrees(${arg(0).code})`, type: "num" };
      case "abs":
      case "frac":
      case "floor":
      case "ceil":
      case "round":
      case "min":
      case "max":
      case "clamp":
      case "mandel": {
        const a = arg(0);
        return {
          code: `${name}(${all()})`,
          type: a.type === "int" && name !== "frac" ? "int" : "num",
        };
      }
      case "imin":
      case "imax":
      case "iclamp":
        return { code: `${name.slice(1)}(${all()})`, type: "int" };
      case "cycle":
      case "icycle":
        return { code: `wrap(${all()})`, type: "num" };
      case "pcycle":
      case "ipcycle":
        return { code: `bounce(${all()})`, type: "num" };
      case "lerp":
      case "v3lerp":
      case "clerp":
      case "ilerp":
        return { code: `mix(${arg(1).code}, ${arg(2).code}, ${arg(0).code})`, type: arg(1).type };
      case "serp":
      case "v3serp":
      case "cserp":
      case "iserp":
        return {
          code: `smoothmix(${arg(1).code}, ${arg(2).code}, ${arg(0).code})`,
          type: arg(1).type,
        };
      case "v3make":
        return { code: `(${all()})`, type: "vec3" };
      case "v2make":
        return { code: `(${arg(0).code}, ${arg(1).code}, 0)`, type: "vec3" };
      case "cmake":
        return {
          code: `hsv(${this.hue(args[0]!, scope, body, name)}, ${arg(1).code}, ${arg(2).code})`,
          type: "colour",
        };
      case "v3x":
      case "v2x":
        return { code: `(${arg(0).code}).x`, type: "num" };
      case "v3y":
      case "v2y":
        return { code: `(${arg(0).code}).y`, type: "num" };
      case "v3z":
        return { code: `(${arg(0).code}).z`, type: "num" };
      case "hue":
        return { code: `((${arg(0).code}).hue / 360)`, type: "num" };
      case "sat":
        return { code: `(${arg(0).code}).sat`, type: "num" };
      case "vol":
        return { code: `(${arg(0).code}).val`, type: "num" };
      case "alp":
        return { code: `(${arg(0).code}).alpha`, type: "num" };
      case "v3length":
      case "v2length":
        return { code: `length(${all()})`, type: "num" };
      case "v3dot":
      case "v2dot":
        return { code: `dot(${all()})`, type: "num" };
      case "v3cross":
        return { code: `cross(${all()})`, type: "vec3" };
      case "v3normal":
      case "v2normal":
        return { code: `normalize(${all()})`, type: "vec3" };
      case "get_posit":
        return { code: "turtle.position", type: "vec3" };
      case "get_scale":
        return { code: "turtle.size", type: "vec3" };
      case "get_x_dir":
      case "get_x_axis":
        return { code: "turtle.side", type: "vec3" };
      case "get_y_dir":
      case "get_y_axis":
        return { code: "turtle.up", type: "vec3" };
      case "get_z_dir":
      case "get_z_axis":
        return { code: "turtle.heading", type: "vec3" };
      case "get_colour":
        return { code: "turtle.colour", type: "colour" };
      case "get_shine":
        return { code: "turtle.shine", type: "num" };
      case "get_sharp":
        return { code: "turtle.sharpness", type: "num" };
      case "is_inverted":
        return { code: "turtle.mirrored", type: "bool" };
      case "cspace": {
        const index = args[0]!;
        const t = arg(1).code;
        if (index.k === "const" && typeof index.value === "number") {
          const space = body.spaces?.get(index.value) ?? this.spaces.get(index.value);
          // Pop's colour spaces start out white.
          if (!space) return { code: "white", type: "colour" };
          return { code: this.sample(space, t), type: "colour" };
        }
        this.popCspace = true;
        return { code: `pop_cspace(${arg(0).code}, ${t})`, type: "colour" };
      }
    }
    const fn = this.parts.get(name);
    if (fn !== undefined) {
      this.warn(`\`${name}\` is a part but is used as a value.`);
    }
    this.warn(`\`${name}(…)\` has no GenoCode translation; it's kept as it is.`);
    return { code: `${name}(${all()})`, type: "unknown" };
  }
}

// ---------- helpers ----------

/** `reshape { a }` and `reshape { b }` on consecutive lines become `reshape { a; b }`. */
function mergeReshapes(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev?.startsWith("reshape { ") && line.startsWith("reshape { ")) {
      out[out.length - 1] = `${prev.slice(0, -2)}; ${line.slice("reshape { ".length)}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

function popType(t: PopType): Type {
  switch (t) {
    case "num":
    case "int":
    case "bool":
    case "vec3":
    case "colour":
      return t;
    case "vec2":
      return "vec3";
    default:
      return "unknown";
  }
}

function defaultValue(t: PopType): string {
  switch (t) {
    case "bool":
      return "false";
    case "vec2":
    case "vec3":
      return "(0, 0, 0)";
    case "colour":
      return "black";
    default:
      return "0";
  }
}

/** Pop rounds numbers stored in `int` variables towards zero; GenoCode has one number type. */
function toType(value: Code, type: Type): string {
  return type === "int" && value.type === "num" ? `floor(${value.code})` : value.code;
}

function kindOf(v: PopConst["value"] | undefined): string {
  return Array.isArray(v) ? `vec${v.length}` : typeof v;
}

/** A colour space built among drawing: `init_cspace` and the `extend_cspace` calls after it. */
interface BuiltHere {
  index: number;
  calls: { name: string; args: PopExpr[] }[];
}

/** The colour space built from `list[i]` on, if it starts one with a fixed index there. */
function builtHere(list: PopStmt[], i: number): BuiltHere | undefined {
  const call = (s: PopStmt | undefined) => (s?.k === "expr" && s.e.k === "call" ? s.e : undefined);
  const first = call(list[i]);
  const index = first?.args[0];
  if (first?.name !== "init_cspace" || first.args.length !== 2) return undefined;
  if (index?.k !== "const" || typeof index.value !== "number") return undefined;
  const calls = [first];
  for (let k = i + 1; ; k++) {
    const next = call(list[k]);
    const at = next?.args[0];
    if (next?.name !== "extend_cspace" || next.args.length !== 3) break;
    if (at?.k !== "const" || at.value !== index.value) break;
    calls.push(next);
  }
  return { index: index.value, calls };
}

/** The names an expression reads. */
function namesIn(e: PopExpr): string[] {
  switch (e.k) {
    case "var":
      return [e.name];
    case "const":
      return [];
    case "neg":
    case "not":
      return namesIn(e.a);
    case "bin":
    case "logic":
      return [...namesIn(e.a), ...namesIn(e.b)];
    case "call":
      return e.args.flatMap(namesIn);
  }
}

function isCall(s: PopStmt, name: string): boolean {
  return s.k === "expr" && s.e.k === "call" && s.e.name === name;
}

function matchingPop(list: PopStmt[], open: number): number {
  let depth = 0;
  for (let i = open; i < list.length; i++) {
    if (isCall(list[i]!, "push")) depth++;
    else if (isCall(list[i]!, "pop") && --depth === 0) return i;
  }
  return -1;
}

/** The step of a loop variable: `x` in `(i + x)` or `((i + a) + b)`. */
function stepOf(e: PopExpr, name: string): PopExpr | undefined {
  if (e.k !== "bin" || e.op !== "+") return undefined;
  if (e.a.k === "var" && e.a.name === name) return e.b;
  const inner = stepOf(e.a, name);
  return inner ? { k: "bin", op: "+", a: inner, b: e.b } : undefined;
}

/** Whether any of the statements uses or sets a variable. */
function mentions(list: PopStmt[], name: string): boolean {
  const inExpr = (e: PopExpr | undefined): boolean => {
    if (!e) return false;
    switch (e.k) {
      case "var":
        return e.name === name;
      case "const":
        return false;
      case "neg":
      case "not":
        return inExpr(e.a);
      case "bin":
      case "logic":
        return inExpr(e.a) || inExpr(e.b);
      case "call":
        return e.args.some(inExpr);
    }
  };
  return list.some((s) => {
    switch (s.k) {
      case "data":
        return inExpr(s.init);
      case "assign":
        return s.name === name || inExpr(s.value);
      case "expr":
        return inExpr(s.e);
      case "return":
        return inExpr(s.value);
      case "if":
        return inExpr(s.cond) || mentions(s.then, name) || mentions(s.els ?? [], name);
      case "while":
        return inExpr(s.cond) || mentions(s.body, name);
      case "for":
        return inExpr(s.init) || inExpr(s.cond) || inExpr(s.step) || mentions(s.body, name);
    }
  });
}

function assigns(body: PopStmt[], name: string): boolean {
  return body.some(
    (s) =>
      (s.k === "assign" && s.name === name) ||
      (s.k === "if" && (assigns(s.then, name) || assigns(s.els ?? [], name))) ||
      ((s.k === "while" || s.k === "for") && assigns(s.body, name)),
  );
}

/** A function that fills the colour space numbered by its first parameter, and draws nothing. */
function isBuilder(f: PopFunction): boolean {
  const index = f.params[0];
  if (index?.type !== "int") return false;
  let fills = false;
  const ok = (list: PopStmt[] | undefined): boolean =>
    (list ?? []).every((s) => {
      switch (s.k) {
        case "data":
        case "assign":
          return true;
        case "if":
          return ok(s.then) && ok(s.els);
        case "while":
        case "for":
          return ok(s.body);
        case "expr": {
          if (s.e.k !== "call") return false;
          const { name, args } = s.e;
          if (name !== "init_cspace" && name !== "extend_cspace") return false;
          fills = true;
          return args[0]?.k === "var" && args[0].name === index.name;
        }
        default:
          return false;
      }
    });
  return ok(f.body) && fills;
}
