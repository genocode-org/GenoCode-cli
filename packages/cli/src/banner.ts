// The GenoCode banner for the command line: the logo's G, laid down as a chain of balls, beside
// the name. Coloured with the logo's blue-to-pink gradient when the output is a colour terminal.

const ART = [
  "   .oOOOo.       ___                   ___          _",
  " .O'     `      / __| ___  _ _   ___  / __| ___  __| | ___",
  " O             | (_ |/ -_)| ' \\ / _ \\| (__ / _ \\/ _` |/ -_)",
  " O    .oOOo     \\___|\\___||_||_|\\___/ \\___|\\___/\\__,_|\\___|",
  " `O.     O'",
  "   `oOOOo'     code, breed and share creatures",
];

/** The tagline on the last line, which is dimmed rather than coloured. */
const TAGLINE = "code, breed and share creatures";

/** The logo's gradient at `t` (0 to 1), as a 24-bit colour escape. */
function gradient(t: number): string {
  const h = 195 + 140 * t;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (1 - 0.75 * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `\x1b[38;2;${f(5)};${f(3)};${f(1)}m`;
}

/** The banner, ending with a newline; with `colour`, coloured with ANSI escapes. */
export function banner(colour: boolean): string {
  if (!colour) return ART.join("\n") + "\n";
  const width = Math.max(...ART.map((l) => l.length));
  const reset = "\x1b[0m";
  const lines = ART.map((line) => {
    const tag = line.indexOf(TAGLINE);
    const art = tag < 0 ? line : line.slice(0, tag);
    let out = "";
    for (let i = 0; i < art.length; i++) {
      out += art[i] === " " ? " " : gradient(i / (width - 1)) + art[i];
    }
    return out + reset + (tag < 0 ? "" : `\x1b[2m${TAGLINE}${reset}`);
  });
  return lines.join("\n") + "\n";
}
