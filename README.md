# ultra-herdr-machine

Public machine CLI for ultra-herdr. This initial foundation implements help/version
only; enrollment, task operations and the visible runtime are not yet available.

Requires Bun 1.4.2 to build. Installed compiled binaries do not require Node.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
./dist/herdr-cli --help
./dist/herdr-cli --version
bun run smoke:ink
```

The versioned public API tarball in `vendor/` permits isolated builds before registry
publication. It contains only public protocol JavaScript, declarations and package
metadata; no private backend source. Future functions are added as implemented.

Keep credentials outside the checkout in protected product configuration. Do not
commit machine configuration, tokens, environment files or signing keys.
