# URL Transformer

A Chrome extension for generating redirect URLs with configurable query parameters and optional JWT authentication.

## Features

- Prefills the source URL from the active HTTP(S) tab when available.
- Builds redirect URLs at the source origin, for example:

  ```text
  https://example.com/?auth_token=<encoded-token>&redirect=<encoded-path>
  ```

- Supports parameter values from a selected token, the source URL path, or a literal value.
- Supports editing and pausing rules without losing their settings.
- Copies generated URLs or opens them in an Incognito window.
- Retains up to eight distinct completed URLs for reuse, along with a local token library.

## Installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository root (the directory containing `manifest.json`).

## Usage

1. Open the extension from Chrome's toolbar.
2. In **Tokens**, add or select a JWT if an enabled parameter uses the selected token.
3. In **Transform**, confirm or edit the source URL and select **Transform URL**.
4. Copy the result or open it in Incognito.

The **Parameters** tab starts with `auth_token` from the selected JWT and `redirect` from the source URL path, query string, and fragment. Both rules are required when enabled, but can be edited or paused. Paused rules remain configured and do not affect generated URLs. Additional rules can be added; optional literal values are omitted when empty.

The **Recent** tab lists the eight latest distinct completed URLs by source
host and path, with query parameter names and the transformation date below
each label. Parameter values are not shown in the list. Repeating a
transformation moves the matching URL to the top. Each entry can be copied,
opened in Incognito, or removed; **Clear all** deletes the entire list.

Opening links in Incognito requires **Allow in Incognito** on the extension's details page in Chrome.

## Development

The popup uses small ES modules with separate responsibilities:

- `popup.js` coordinates startup, shared state, and URL transformation.
- `src/parameter-workspace.mjs` manages parameter editing, toggles, and rendering.
- `src/token-workspace.mjs` manages saved tokens and selection.
- `src/recent-workspace.mjs` manages transformed URL history.
- `src/parameter-rules.mjs` contains pure URL-transformation and parameter-rule logic.
- `src/recent-urls.mjs` normalizes and bounds recent transformed URLs.
- `src/token-utils.mjs` normalizes tokens and derives JWT display metadata.
- `src/chrome-api.mjs` isolates Chrome and clipboard APIs, queues writes by domain, and restores saved state after failed writes.
- `src/icons.mjs` owns reusable UI icons.

Node.js is required to run the tests; no third-party dependencies are needed:

```sh
npm test
```

The Node built-in test runner covers rule validation and URL composition,
recent-link deduplication and limits, token metadata decoding, and queued
Chrome storage callbacks.

## Packaging

The `zip` command is required to build a Chrome Web Store upload archive:

```sh
npm run package
```

The archive is written to `dist/<name>-<manifest version>.zip` using values
from `manifest.json`. It contains only runtime files: the manifest, popup,
`src/` modules, and icons. Tests, tooling, dotfiles, and full-resolution
`*-master.*` design sources are excluded. Increment the manifest version
before packaging a new release.

## Privacy and security

The selected token, token library, parameter rules, and recent links are stored
in Chrome's local extension storage. Recent displays source hostnames, paths,
and parameter names,
but stores complete generated URLs, including token query parameters. Removing
a saved token does not remove it from recent links. Generated URLs can also
expose tokens through browser history, server logs, and referrer headers;
Incognito does not prevent server-side logging. Clear sensitive recent links
when no longer needed. Literal parameter values are also persisted locally
and should not contain secrets.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Pre-fill the source URL from the active tab when available. |
| `clipboardWrite` | Copy transformed URLs and saved tokens. |
| `storage` | Persist the selected token, token library, parameter rules, and recent links locally. |
