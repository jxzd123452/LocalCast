# Contributing to LocalCast

Thanks for looking. LocalCast is a small local-network file share. Changes should stay easy to run on Windows, macOS, and Linux.

## Setup

```bash
npm install
npm test
npm run build
npm start
```

`npm run localcast` runs the TypeScript entry directly. `npm start` uses `dist/` when it exists.

## Tests

```bash
npm test
```

The suite covers the product checks: homepage, listing and download, awkward file names, preview responses, large-file HTTP Range, concurrent reads, upload progress, path traversal and symlink escapes, and token expiry / room close. Please run it before sending a change. Do not invent results for a platform you did not run.

Symlink tests skip themselves when the OS refuses to create symlinks (common on Windows without Developer Mode). Lexical traversal checks still run everywhere.

## Security

- Do not log session tokens, guest URLs, or clipboard text.
- Admin actions stay on the loopback interface and reject a foreign `Host` or `Origin`.
- Shared files stay inside the chosen folder. Do not add a way for a remote client to choose a server path.
- Uploads go only to `Inbox`, and only when the person at the computer turns them on.
- Do not add a public tunnel or a third-party file host.

Report a vulnerability privately to the repository maintainers. Please avoid opening a public issue that includes a working exploit.

## Design

The interface is English first, with Simplified Chinese. Add strings to both dictionaries in `web/src/i18n.ts`. Keep the plain-HTTP warning visible. Do not describe a LAN as absolutely safe.

Screenshots under `docs/` were taken from a running LocalCast process. `scripts/capture-screenshots.mjs` expects system Chrome plus `playwright-core`, which is not installed by `npm install`. It is not part of the test suite.

## License

Your contributions are under the MIT license in `LICENSE`. Do not copy code from LocalSend, PairDrop, or other projects. Dependency licenses, including sharp and libvips, are recorded in `NOTICE`.
