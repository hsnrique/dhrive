# Contributing

Thanks for helping. Bugs and ideas go to [issues](https://github.com/hsnrique/dhrive/issues) or the
[Discord](https://discord.gg/wKwzSV3dyJ).

## Pull requests

- One change per pull request, small enough to review in one sitting.
- Tests come with the code. Both suites pass before you open it:
  `cargo test --manifest-path src-tauri/Cargo.toml` and `npm test --prefix frontend`.
- Files stay under 300 lines and functions under 20. Comments say why, not what.
- Dependencies are pinned to exact versions. No secrets, keys or tokens in code, tests or history.
- Never render model output as HTML.

## Sign-off

Every commit carries a [Developer Certificate of Origin](https://developercertificate.org) sign-off:
`git commit -s`. It says you wrote the change, or have the right to submit it under this
project's license.
