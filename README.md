<p align="center"><img src="https://raw.githubusercontent.com/genocode-org/GenoCode/main/branding/logo-lockup.svg" alt="GenoCode" width="480"></p>

# GenoCode-cli

`genie`, the command line for [GenoCode](https://github.com/genocode-org/GenoCode): check, format
and draw `.genie` creature files without a browser.

```
genie check Flower.genie            # report errors and warnings
genie format --write *.genie        # put files in the standard layout
genie genes Flower.genie            # list a creature's genes
genie build Flower.genie            # build a creature and report its shapes (--json for all of them)
genie render Flower.genie out.png   # draw it (--size=N, default 512; --time=T seconds)
```

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

## License

Released under the [MIT License](LICENSE). See [CREDITS.md](CREDITS.md).
