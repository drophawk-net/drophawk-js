# drophawk-js

JavaScript and TypeScript packages for the [DropHawk developer API](https://developers.drophawk.net).
This README is for contributors; each package's README is its user documentation.

| Package | What it is |
| --- | --- |
| [`@drophawk/sdk`](packages/sdk) | Typed client for the developer API. |
| [`@drophawk/mcp`](packages/mcp) | MCP server for AI assistants, built on the SDK. |

## Where the contract comes from

The DropHawk backend is private.
This repository takes two files from it, and generates code from each:

- `spec/developer-v1.openapi.json` generates the SDK's types (`packages/sdk/src/generated/api.ts`).
- `spec/catalogue-limits.txt` generates the MCP server's catalogue caveats (`packages/mcp/src/generated/catalogue-limits.ts`).

Never edit either by hand.
When the sources change on DropHawk's `main`, a DropHawk workflow copies the two files to the `sync-spec` branch here and opens or updates one pull request, running no code from this repository.
`spec-regenerate.yml` then runs `bun run generate` on that pull request with no secrets, and `spec-regenerate-push.yml` (a `workflow_run` job, so always `main`'s copy) validates the output and pushes it to `sync-spec` with the regenerate App.
CI fails until that commit lands, and on any pull request whose generated files do not match `spec/`.
Review the whole sync diff, generated files included, before merging.

## Development

```sh
bun install --frozen-lockfile
bun run generate                          # after changing spec/; add -- --check to verify
bun run --filter @drophawk/sdk typecheck
bun run --filter @drophawk/sdk test       # also type-checks the README's ts blocks
bun run --filter @drophawk/sdk build      # the MCP package builds against the SDK's dist
bun run --filter @drophawk/mcp typecheck
bun run --filter @drophawk/mcp test       # builds, then unit and stdio end-to-end tests
```

Dependencies install with a seven-day minimum release age (`bunfig.toml`), and Dependabot updates them with a cooldown.

## Releasing

Run `bun run changeset` for any change to a published package, READMEs included, and commit the file.
Never edit versions or changelogs by hand.

`release.yml` runs three jobs with separate privileges:

1. `version` opens the "chore: version packages" pull request with the release App's token, so CI runs on it.
   With no App configured it fails, naming what is missing.
2. Once that pull request is merged, `build` tests, builds and packs tarballs with read-only access, rewriting the MCP package's `workspace:` dependency on the SDK to a real range.
3. `publish`, approved on the `npm` environment, publishes those tarballs (SDK first) through npm trusted publishing with provenance, and tags each version.
   A rerun skips versions already on npm with identical contents and fails on any that differ.

On npmjs.com, each package's trusted publisher names `release.yml` and environment `npm`, so rename neither, and each package requires 2FA and disallows tokens.

## GitHub Apps and environments

Each writer is its own `drophawk-net` GitHub App, installed only on drophawk-js and never a ruleset bypass actor.
Each environment deploys from `main` only.

| App | Workflow repo | Environment | Permissions | Client ID variable | Private key secret |
| --- | --- | --- | --- | --- | --- |
| Release | drophawk-js | `release` | Contents, Pull requests: write | `DROPHAWK_JS_RELEASE_CLIENT_ID` | `DROPHAWK_JS_RELEASE_PRIVATE_KEY` |
| Spec regenerate | drophawk-js | `spec-regenerate` | Contents: write | `DROPHAWK_JS_REGEN_CLIENT_ID` | `DROPHAWK_JS_REGEN_PRIVATE_KEY` |
| Spec sync | DropHawk | `drophawk-js-sync` | Contents, Pull requests: write | `DROPHAWK_JS_SYNC_CLIENT_ID` (repository) | `DROPHAWK_JS_SYNC_PRIVATE_KEY` |

The `npm` environment holds no secrets.

## Security and license

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).
[MIT](LICENSE) licensed.
