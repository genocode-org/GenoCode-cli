// Reading Pop, the creature language of DancerDNA (1999) that GenoCode grew from, so that
// `genie translate` can turn old creatures into GenoCode. A `.pop` file holds a population: a
// header of settings, then each member's genome, a program in Pop.

/** A `.pop` file's genomes, as Pop source text. */
export interface Population {
  settings: Map<string, string>;
  genomes: string[];
}

/**
 * Reads a `.pop` file. Saved populations start with a short binary header (a length-prefixed
 * name, then the text's length); exported ones are plain text.
 */
export function readPopulation(bytes: Uint8Array): Population {
  let text: string;
  if (bytes.length > 5 && bytes[0]! < 0x20) {
    const n = bytes[0]!;
    const length =
      bytes[1 + n]! | (bytes[2 + n]! << 8) | (bytes[3 + n]! << 16) | (bytes[4 + n]! << 24);
    text = latin1(bytes.subarray(5 + n, 5 + n + length));
  } else {
    text = latin1(bytes);
  }
  return parsePopulation(text);
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

export function parsePopulation(text: string): Population {
  text = text.replace(/\r/g, "");
  const settings = new Map<string, string>();
  const head = /pop\s+\w+\s*\{([\s\S]*?)\n\s*end\b/.exec(text);
  for (const line of head?.[1]?.split("\n") ?? []) {
    const m = /^\s*([A-Za-z_]\w*)\s+(.+?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("//")) settings.set(m[1]!, m[2]!);
  }
  const genomes: string[] = [];
  const start = /genome\s+\w+\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(text, open);
    genomes.push(text.slice(open + 1, close));
    start.lastIndex = close + 1;
  }
  return { settings, genomes };
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  throw new PopError("A genome's `{` is never closed.");
}

export class PopError extends Error {}

// ---------- the syntax tree ----------

export type PopType = "num" | "int" | "bool" | "vec2" | "vec3" | "colour" | "string" | "void";

/** A literal in square brackets: `[2.5]`, `[<1,0,0>]`, `[true]`, or a gene `[v]:[min]:[max]`. */
export interface PopConst {
  k: "const";
  value: number | boolean | number[];
  /** Written without a decimal point. */
  isInt: boolean;
  /** Genes only. */
  min?: number | boolean | number[];
  max?: number | boolean | number[];
}

export type PopExpr =
  | PopConst
  | { k: "var"; name: string }
  | { k: "neg" | "not"; a: PopExpr }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; a: PopExpr; b: PopExpr }
  | { k: "logic"; op: "&" | "|"; a: PopExpr; b: PopExpr }
  | { k: "call"; name: string; args: PopExpr[] };

export type PopStmt =
  | { k: "data"; type: PopType; name: string; init: PopExpr | undefined }
  | { k: "assign"; name: string; value: PopExpr }
  | { k: "expr"; e: PopExpr }
  | { k: "if"; cond: PopExpr; then: PopStmt[]; els: PopStmt[] | undefined }
  | { k: "while"; cond: PopExpr; body: PopStmt[] }
  | {
      k: "for";
      type: PopType | undefined;
      name: string;
      init: PopExpr;
      cond: PopExpr;
      step: PopExpr;
      body: PopStmt[];
    }
  | { k: "return"; value: PopExpr | undefined };

export interface PopFunction {
  name: string;
  ret: PopType;
  params: { type: PopType; name: string }[];
  body: PopStmt[];
}

export interface PopProgram {
  globals: PopStmt[];
  /** In the order they're defined. */
  functions: PopFunction[];
}

/** A gene: a literal with a range, `[v]:[min]:[max]`. */
export type PopGene = PopConst & Required<Pick<PopConst, "min" | "max">>;

export const isGene = (e: PopExpr): e is PopGene => e.k === "const" && e.min !== undefined;

// ---------- reading a program ----------

interface Token {
  t: string;
  v?: string | number;
  int?: boolean;
  line: number;
}

const PUNCTUATION = new Set("(){}[]<>,;:+-*/%^!=&|");
const TYPES = new Set(["num", "int", "bool", "vec2", "vec3", "colour", "string", "void"]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  for (let i = 0; i < src.length;) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
    } else if (c <= " ") {
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\w/.test(src[j]!)) j++;
      tokens.push({ t: "id", v: src.slice(i, j), line });
      i = j;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i))!;
      tokens.push({ t: "num", v: parseFloat(m[0]), int: !/[.eE]/.test(m[0]), line });
      i += m[0].length;
    } else if (PUNCTUATION.has(c)) {
      tokens.push({ t: c, line });
      i++;
    } else {
      throw new PopError(`line ${line}: unexpected character \`${c}\``);
    }
  }
  tokens.push({ t: "eof", line });
  return tokens;
}

/** Reads a genome's program. */
export function parsePop(src: string): PopProgram {
  const tokens = tokenize(src);
  let p = 0;
  const peek = (k = 0) => tokens[p + k]!;
  const next = () => tokens[p++]!;
  const is = (t: string, v?: string) => peek().t === t && (v === undefined || peek().v === v);
  const expect = (t: string, v?: string): Token => {
    const tok = next();
    if (tok.t !== t || (v !== undefined && tok.v !== v)) {
      throw new PopError(`line ${tok.line}: expected ${v ?? t}, found ${tok.v ?? tok.t}`);
    }
    return tok;
  };
  const name = () => expect("id").v as string;

  function signed(): number {
    let sign = 1;
    if (is("-")) {
      next();
      sign = -1;
    }
    return sign * (expect("num").v as number);
  }

  /** `[…]`: a number, a vector, a bool, or a named constant. */
  function bracketed(): { value: PopConst["value"] | { name: string }; isInt: boolean } {
    expect("[");
    let value: PopConst["value"] | { name: string };
    let isInt = false;
    if (is("<")) {
      next();
      const parts: number[] = [];
      while (!is(">")) {
        parts.push(signed());
        if (is(",")) next();
      }
      next();
      value = parts;
    } else if (is("id", "true") || is("id", "false")) {
      value = next().v === "true";
    } else if (is("id")) {
      value = { name: name() };
    } else {
      const negative = is("-");
      if (negative) next();
      const tok = expect("num");
      value = (negative ? -1 : 1) * (tok.v as number);
      isInt = tok.int === true;
    }
    expect("]");
    return { value, isInt };
  }

  function constant(): PopExpr {
    const v = bracketed();
    if (typeof v.value === "object" && !Array.isArray(v.value))
      return { k: "var", name: v.value.name };
    const node: PopConst = { k: "const", value: v.value as PopConst["value"], isInt: v.isInt };
    if (is(":")) {
      next();
      node.min = bracketed().value as PopConst["value"];
      expect(":");
      node.max = bracketed().value as PopConst["value"];
    }
    return node;
  }

  function primary(): PopExpr {
    if (is("[")) return constant();
    if (is("(")) {
      next();
      const e = expr();
      expect(")");
      return e;
    }
    if (is("-")) {
      next();
      return { k: "neg", a: primary() };
    }
    if (is("!")) {
      next();
      return { k: "not", a: primary() };
    }
    const id = name();
    if (!is("(")) return { k: "var", name: id };
    next();
    const args: PopExpr[] = [];
    while (!is(")")) {
      args.push(expr());
      if (is(",")) next();
    }
    next();
    return { k: "call", name: id, args };
  }

  function power(): PopExpr {
    let a = primary();
    while (is("^")) {
      next();
      a = { k: "bin", op: "^", a, b: primary() };
    }
    return a;
  }
  function product(): PopExpr {
    let a = power();
    while (is("*") || is("/") || is("%")) {
      const op = next().t as "*" | "/" | "%";
      a = { k: "bin", op, a, b: power() };
    }
    return a;
  }
  function sum(): PopExpr {
    let a = product();
    while (is("+") || is("-")) {
      const op = next().t as "+" | "-";
      a = { k: "bin", op, a, b: product() };
    }
    return a;
  }
  function expr(): PopExpr {
    let a = sum();
    while (is("&") || is("|")) {
      const op = next().t as "&" | "|";
      a = { k: "logic", op, a, b: sum() };
    }
    return a;
  }

  function block(): PopStmt[] {
    expect("{");
    const body: PopStmt[] = [];
    while (!is("}")) body.push(statement());
    next();
    return body;
  }

  function statement(): PopStmt {
    if (is("id", "data")) {
      next();
      const type = name() as PopType;
      const id = name();
      let init: PopExpr | undefined;
      if (is("=")) {
        next();
        init = expr();
      }
      expect(";");
      return { k: "data", type, name: id, init };
    }
    if (is("id", "if")) {
      next();
      expect("(");
      const cond = expr();
      expect(")");
      const then = block();
      let els: PopStmt[] | undefined;
      if (is("id", "else")) {
        next();
        els = is("id", "if") ? [statement()] : block();
      }
      return { k: "if", cond, then, els };
    }
    if (is("id", "while")) {
      next();
      expect("(");
      const cond = expr();
      expect(")");
      return { k: "while", cond, body: block() };
    }
    if (is("id", "for")) {
      next();
      expect("(");
      let type: PopType | undefined;
      if (is("id") && TYPES.has(peek().v as string) && peek(1).t === "id") type = name() as PopType;
      const id = name();
      expect("=");
      const init = expr();
      expect(";");
      const cond = expr();
      expect(";");
      const step = expr();
      expect(")");
      return { k: "for", type, name: id, init, cond, step, body: block() };
    }
    if (is("id", "return")) {
      next();
      const value = is(";") ? undefined : expr();
      expect(";");
      return { k: "return", value };
    }
    if (is("id") && peek(1).t === "=") {
      const id = name();
      next();
      const value = expr();
      expect(";");
      return { k: "assign", name: id, value };
    }
    const e = expr();
    expect(";");
    return { k: "expr", e };
  }

  expect("id", "prog");
  const functions: PopFunction[] = [];
  const globals: PopStmt[] = [];
  while (!is("eof")) {
    if (is("id", "func")) {
      next();
      const ret = name() as PopType;
      const id = name();
      expect("(");
      const params: PopFunction["params"] = [];
      while (!is(")")) {
        const type = name() as PopType;
        params.push({ type, name: name() });
        if (is(",")) next();
      }
      next();
      if (is(";")) {
        next(); // a forward declaration
        continue;
      }
      // A function defined twice: the later definition is the one that runs.
      const f = { name: id, ret, params, body: block() };
      const earlier = functions.findIndex((g) => g.name === id);
      if (earlier >= 0) functions[earlier] = f;
      else functions.push(f);
    } else if (is("id", "data")) {
      globals.push(statement());
    } else {
      throw new PopError(`line ${peek().line}: unexpected ${peek().v ?? peek().t}`);
    }
  }
  return { globals, functions };
}

/** Every gene in a program, in a fixed order, so members of a population line up gene for gene. */
export function genesOf(program: PopProgram): PopConst[] {
  const genes: PopConst[] = [];
  const visit = (e: PopExpr | undefined): void => {
    if (!e) return;
    switch (e.k) {
      case "const":
        if (isGene(e)) genes.push(e);
        return;
      case "neg":
      case "not":
        visit(e.a);
        return;
      case "bin":
      case "logic":
        visit(e.a);
        visit(e.b);
        return;
      case "call":
        e.args.forEach(visit);
        return;
    }
  };
  const visitAll = (body: PopStmt[] | undefined): void => {
    for (const s of body ?? []) {
      switch (s.k) {
        case "data":
          visit(s.init);
          break;
        case "assign":
          visit(s.value);
          break;
        case "expr":
          visit(s.e);
          break;
        case "return":
          visit(s.value);
          break;
        case "if":
          visit(s.cond);
          visitAll(s.then);
          visitAll(s.els);
          break;
        case "while":
          visit(s.cond);
          visitAll(s.body);
          break;
        case "for":
          visit(s.init);
          visit(s.cond);
          visit(s.step);
          visitAll(s.body);
          break;
      }
    }
  };
  visitAll(program.globals);
  for (const f of program.functions) visitAll(f.body);
  return genes;
}
