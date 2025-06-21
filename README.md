# URL Transformer

A Chrome extension for building authenticated redirect URLs from a target URL and a JWT token.

## What it does

- Starts with the active browser tab's URL when it is an HTTP(S) page.
- Accepts a target URL or hostname/path and a JWT token.
- Builds a URL in this form:

  ```text
  https://example.com/?auth_token=<encoded-token>&redirect=<encoded-path>
  ```

- Lets you copy the transformed URL or open it in an Incognito window.
- Keeps a local library of saved tokens for quick reuse.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder: `/path/to/UrlTransformer`.

## Use

1. Open the extension from Chrome's toolbar.
2. Enter or confirm the source URL.
3. Paste a JWT token, then optionally select **Save** to keep it in the local token library.
4. Select **Transform**.
5. Copy the result or open it in Incognito.

To use the Incognito action, enable **Allow in Incognito** for the extension on its Chrome details page.

## Privacy and security

Saved tokens are stored locally through Chrome extension storage. The generated URL includes the JWT token as an `auth_token` query parameter, so treat copied, shared, browser-history, and logged URLs as sensitive. Remove saved tokens when they are no longer needed.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Pre-fill the source URL from the active tab when available. |
| `clipboardWrite` | Copy transformed URLs and saved tokens. |
| `storage` | Persist the current token and saved token library locally. |
