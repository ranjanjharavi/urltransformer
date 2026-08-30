# URL Transformer

A Chrome extension for building JWT-authenticated redirect URLs for protected pages.

## What it does

- Starts with the active browser tab's URL when it is an HTTP(S) page.
- Builds protected-page authentication URLs in this form:

  ```text
  https://example.com/?auth_token=<encoded-token>&redirect=<encoded-path>
  ```

- Lets you add composable query-parameter rules alongside the protected `auth_token` and `redirect` parameters.
- Lets you copy the transformed URL or open it in an Incognito window.
- Keeps a local library of saved tokens for quick reuse.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder: `/path/to/UrlTransformer`.

## Use

1. Open the extension from Chrome's toolbar.
2. Open **Tokens** to add or select a JWT.
3. Return to **Transform** and enter or confirm the source URL.
4. Select **Transform URL**.
5. Copy the result or open it in Incognito.

The **Parameters** workspace starts with `auth_token` from the selected JWT and `redirect` from the source URL path, query string, and hash. Edit either parameter or choose **Add** to open the same parameter editor.

Each parameter can get its value from the selected token, the page path, or a custom value. Parameters with blank optional custom values are omitted automatically. Use **Tokens** to add, inspect, select, copy, or remove saved JWTs.

To use the Incognito action, enable **Allow in Incognito** for the extension on its Chrome details page.

## Development

The popup uses small ES modules with separate responsibilities:

- `popup.js` coordinates UI state and events.
- `src/parameter-rules.mjs` contains pure URL-transformation and parameter-rule logic.
- `src/token-utils.mjs` normalizes tokens and derives JWT display metadata.
- `src/chrome-api.mjs` isolates Chrome and clipboard APIs.
- `src/icons.mjs` owns reusable UI icons.

Run the domain tests with:

```sh
npm test  # or: node --test tests/*.test.mjs
```

`tests/parameter-rules.test.mjs` covers rule normalization/migration, the editor
validation rules, and URL composition; `tests/token-utils.test.mjs` covers the
token library and JWT decoding. No dependencies are needed — the suite runs on
the Node built-in test runner.

## Packaging

Build a Chrome Web Store upload archive with:

```sh
npm run package  # or: ./scripts/package.sh
```

The script writes `dist/<name>-<manifest version>.zip`, taking the name and
version straight from `manifest.json`. It packs only the runtime files —
`manifest.json` at the archive root, the popup, `src/`, and the icon sizes —
and leaves out tests, tooling, dotfiles, and the full-resolution
`*-master.*` design sources. It fails loudly if a required file is missing, so
bump the version in `manifest.json` before packaging a new upload.

## Privacy and security

Saved tokens and parameter rules are stored locally through Chrome extension storage. Generated URLs include a JWT query parameter, so treat copied, shared, browser-history, referrer, and logged URLs as sensitive. Static parameter values are persisted locally; do not use them for secrets. Remove saved tokens when they are no longer needed.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Pre-fill the source URL from the active tab when available. |
| `clipboardWrite` | Copy transformed URLs and saved tokens. |
| `storage` | Persist the current token, saved token library, and parameter rules locally. |
