# @genocode/cli

`genie`, the command line for [GenoCode](https://github.com/genocode-org/GenoCode): check, format,
draw, mutate, breed and morph `.genie` creature files without a browser.

```
npm install -g @genocode/cli
```

```
genie check Flower.genie            # report problems, or OK and what the file holds
genie format --write *.genie        # put files in the standard layout
genie genes Flower.genie            # list a creature's genes
genie variants Cobra.genie          # list its variants and the genes each one sets
genie build Flower.genie            # build a creature and report its shapes (--json for all of them)
genie render Flower.genie out.png   # draw it (--size=N, default 512; --time=T seconds)
genie render --variant=Spotty --music=bass:0.8 --beat=0.25 Flower.genie out.png
                                    # a variant, at a moment of a song
genie mutate Flower.genie New.genie # a variation (--strength=S, --seed=N, --lock=a,b)
genie breed A.genie B.genie C.genie # a child of two creatures, with A's code
                                    # (creatures that say `breed off` are refused)
genie morph --at=0.3 A.genie B.genie M.genie  # the creature 30% of the way from A to B
genie jumps Cobra.genie             # where colours jump as it morphs through its variants
genie translate Cobra.pop Cobra.genie          # a DancerDNA population as GenoCode
```

`genie translate` turns a DancerDNA (1999) population file into one GenoCode creature: the first
member's program, with its genes named, and every other member as a `variant`. See the
[repository](https://github.com/genocode-org/GenoCode-cli) for more.

Needs Node.js 22 or later. While the version is 0.x, any minor release may change the commands.

MIT licensed.
