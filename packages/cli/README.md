# @genocode/cli

`genie` is the command line for [GenoCode](https://github.com/genocode-org/GenoCode), a small
language for creatures you can code, breed and dance. A creature is a `.genie` text file. With
`genie` you can check, format, draw, mutate, breed and morph creatures from a terminal or a
script, with no browser.

![A Medusa jellyfish drawn by genie from five sides](https://raw.githubusercontent.com/genocode-org/GenoCode-cli/main/docs/medusa-views.png)

To write and watch creatures in the browser, use the [GenoCode app](https://genocode.piorek.co.za).

## Install

Needs [Node.js](https://nodejs.org) 22 or later.

```
npm install -g @genocode/cli
genie --help
```

Any creature in GenoCode's [starter library](https://github.com/genocode-org/GenoCode/tree/main/creatures)
works with the examples below.

## Commands

- `genie check Medusa.genie`: report problems, or OK and what the file holds.
- `genie genes Medusa.genie`: list a creature's genes.
- `genie variants Medusa.genie`: list its variants and the genes each one sets.
- `genie render Medusa.genie medusa.png`: draw it. Add `--size=N`, `--time=T`, `--variant=Name`,
  `--view=top` or `--views`, or `--music=bass:0.8 --beat=0.25` to see it at a moment of a song.
- `genie mutate Medusa.genie New.genie`: a variation of a creature.
- `genie breed Medusa.genie Starfish.genie Child.genie`: a child of two creatures, with the first
  one's code.
- `genie morph --at=0.3 Medusa.genie Starfish.genie Between.genie`: the creature 30% of the way
  from one to the other.
- `genie format --write *.genie`: put files in the standard layout.
- `genie build Medusa.genie`: build a creature and report its shapes.
- `genie jumps Medusa.genie`: find where colours jump as it morphs through its variants.
- `genie translate Old.pop New.genie`: turn a DancerDNA population file into one GenoCode
  creature, with the other members as variants.
- `genie --version`: the versions of `genie`, the language and the renderer.

`genie --help` lists every option, and the
[repository](https://github.com/genocode-org/GenoCode-cli#readme) explains each command.

While the version is 0.x, any minor release may change the commands.

MIT licensed.
