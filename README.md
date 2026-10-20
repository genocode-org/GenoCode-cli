<p align="center"><img src="https://raw.githubusercontent.com/genocode-org/GenoCode/main/branding/logo-lockup.svg" alt="GenoCode" width="480"></p>

# GenoCode-cli

`genie`, the command line for [GenoCode](https://github.com/genocode-org/GenoCode): check, format,
draw, mutate, breed and morph `.genie` creature files without a browser.

```
npm install -g @genocode/cli
```

```
genie check Flower.genie            # report errors and warnings
genie format --write *.genie        # put files in the standard layout
genie genes Flower.genie            # list a creature's genes
genie variants Cobra.genie          # list its variants and the genes each one sets
genie build Flower.genie            # build a creature and report its shapes (--json for all of them)
genie render Flower.genie out.png   # draw it (--size=N, default 512; --time=T seconds)
genie mutate Flower.genie New.genie # a variation (--strength=S, --seed=N, --lock=a,b)
genie breed A.genie B.genie C.genie # a child of two creatures, with A's code
genie morph --at=0.3 A.genie B.genie M.genie  # the creature 30% of the way from A to B
genie translate Cobra.pop Cobra.genie          # a DancerDNA population as GenoCode
```

**Translating DancerDNA creatures.** `genie translate` turns a DancerDNA (1999) population file
into one GenoCode creature: the first member's program, with its genes named, and every other
member as a `variant`. The result builds the same shapes in the same colours as the original, and
keeps Pop's quirks to do so: turns on a mirrored turtle go through `pop_turn`, and colour spaces
blend hue in a straight line through `pop_blend`. It's a starting point for tidying by hand, so it
keeps the original's structure and marks what it couldn't translate (such as textures) with
`// TODO` comments, which it also lists as it runs. No DancerDNA files are included here.

## Development

You need Node.js 22 or later (see `.nvmrc`). The language and the renderer come from npm as
[`@genocode/core`](https://www.npmjs.com/package/@genocode/core) and
[`@genocode/render`](https://www.npmjs.com/package/@genocode/render).

```
npm install
npm run check     # build, type-check, test and check formatting, as CI does
```

After `npm run build`, run `node packages/cli/dist/main.js <command>`, or `npm link -w @genocode/cli`
once to get a `genie` command.

To try a change in `@genocode/core` before it's released, build it in a GenoCode checkout and run
`npm link ../GenoCode/packages/core` here.

## Releasing

Bump `version` in `packages/cli/package.json`, commit, and push a tag such as `v0.2.0`. The release
workflow stages the new version on npm, where it waits for approval.

## License

Released under the [MIT License](LICENSE). See [CREDITS.md](CREDITS.md).
