# Desktop website-update bridge

Only desktop is changed. VS Code / PyCharm releases remain independently published.

## User flow

1. Existing AI Free installations receive one last bridge update through their existing GitHub updater.
2. After restarting the bridge, update checks use `https://synvox.pro/desktop/update.json`, not GitHub.
3. A newer signed release enables the existing Update button. The program downloads it, verifies Ed25519 signature and SHA-256, stages files, saves old code, replaces code and restarts through the existing restart route.
4. `.env`, `.git`, unrelated top-level files and `~/.deepseek-cli` are not replaced. No subscription lock or payment is activated by this bridge.

## Release preparation

The checked-in website manifest is deliberately `pending`: there is no paid build ready to serve yet. An unreachable endpoint does not fall back to GitHub and does not block current app usage.

Use a clean checkout of the selected release, not the current development worktree. Include the desktop bridge module, installer, server import, UI changes and public verification key. Do not copy plugin folders or accumulated unrelated changes into the bridge release. Bump its version only when preparing that release.

The private Ed25519 key is stored outside the repository. Keep a secure backup; never copy it to the website or commit it. Its matching public key is pinned in `src/desktop-transition.mjs`.

```
node scripts/build-desktop-update.mjs CLEAN_RELEASE_CHECKOUT OUTPUT_DIRECTORY PRIVATE_KEY_PATH
```

The script rejects dirty checkouts and produces `releases/VERSION.json.gz` and signed `update.json`. Publish the bundle to `/desktop/releases/` first, verify its hash, then atomically replace `/desktop/update.json` last. Serve over HTTPS without redirects, preferably `Cache-Control: no-store` for the manifest. Do not overwrite a published version's bundle. Test each OS before publishing a universal manifest.

Leave the original GitHub bridge available for late updaters. New commercial development may be private; old copies cannot discover the website before receiving the bridge.

## Safety and limits

- The package only manages `bin`, `src`, `api`, `packages`, `package.json`; changed dependencies are staged with npm before replacement. Browser provisioning remains the existing application bootstrap's responsibility.
- Updates cannot run concurrently; no files are installed from unsigned manifests or mismatching bundles. Case collisions, traversal, symlinks and unapproved paths are rejected.
- Old code remains in `.synvox-updates/release-*/backup`, with a transaction record. Ordinary installation failures restore moved files.
- This is a Node/git-clone desktop updater, not an updater for a future native packaged installer. Existing executable packages need separate validation.
- Replacement spans multiple directories, not one atomic filesystem operation. Power loss / forced process termination during replacement may require restoring the saved directories manually; inspect `transaction.json` and `.synvox-update.lock` before retrying. Do not remove the lock while an updater is running. No crash-recovery guarantee is claimed.
- Dependencies come from npm if their specification changes. Application releases and update metadata come only from synvox.pro.
- Close active agent tasks before installing. Verify restart and account/chat persistence on a copied installation before publishing.

## Verification

`node --test test/desktop-transition.test.mjs test/updater.test.mjs test/ui-html-script.test.mjs test/window-server.test.mjs`

No release, server upload, repository-visibility change or paid activation is performed by this implementation.
