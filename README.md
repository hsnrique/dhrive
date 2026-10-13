# dhrive

**The Autonomous AI Company.** Say what should exist. dhrive creates the company and runs it, with
the AI you already have.

dhrive is a macOS app that drives the coding CLIs you already use ([Claude Code](https://docs.claude.com/en/docs/claude-code/setup)
and [Codex](https://developers.openai.com/codex/cli/)), with their own sign-in and billing. It never
holds an API key. A company is a folder on your Mac: dhrive plans its day, runs its tasks, checks
every delivery (lint, typecheck, tests, build) and publishes its website.

Download the signed app at [dhrive.app](https://dhrive.app). Talk to us on [Discord](https://discord.gg/wKwzSV3dyJ).

## Develop

You need macOS on Apple Silicon, Rust (stable), Node 22, the [Tauri CLI](https://v2.tauri.app/reference/cli/)
and at least one of the CLIs above.

```sh
npm ci --prefix frontend
cargo tauri dev
```

Tests: `cargo test --manifest-path src-tauri/Cargo.toml` and `npm test --prefix frontend`.

- **Backend:** Rust (Tauri 2) in [`src-tauri/`](src-tauri). [`engine/`](src-tauri/src/engine) runs
  each CLI and reads its event stream; [`flow.rs`](src-tauri/src/flow.rs) turns a step into a prompt.
- **Frontend:** React, TypeScript, Vite, Tailwind v4 and Zustand in [`frontend/`](frontend).

A build from source signs in to a dhrive.app account like the release does. Accounts, the site host
and updates are services of dhrive.app.

## Release

Push a `v*` tag. [`release.yml`](.github/workflows/release.yml) tests, builds, signs, notarizes and
publishes; the tag's note in [`changelog/`](changelog) becomes the release notes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[FSL-1.1-ALv2](LICENSE.md): use it, change it and share it for anything except a competing
product. Each version becomes Apache 2.0 two years after its release. "dhrive" and its logo are
trademarks of Cyos Technologies LTDA. Third-party notices are in [NOTICE.md](NOTICE.md).
