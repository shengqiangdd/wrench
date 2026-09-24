# Browser-side SSH preview (Chrome Isolated Web App)

The ordinary Wrench website cannot open raw TCP sockets. Chrome [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets) is available to installed Isolated Web Apps (IWAs), not ordinary pages. The separate IWA build now contains an experimental SSH terminal backed by a Go WebAssembly client using `golang.org/x/crypto/ssh`. It connects from the user's browser computer directly to an SSH server on that computer's private network. It does not route SSH traffic through Wrench's backend.

## What works

- Password authentication and an interactive `xterm-256color` shell over Chrome IWA Direct Sockets.
- SSH server public key fingerprint display and local trust-on-first-use (TOFU) pinning. On first connection, verify the fingerprint through a separate trusted channel before accepting. The pin is stored in this browser profile's local storage. A changed fingerprint is refused. Clearing this app's browser storage clears those pins.
- Password is only held in the page/Go WebAssembly memory for the connection and cleared from the form after successful login. It is not saved or sent to Wrench servers.
- One active SSH shell per IWA window. SFTP, private-key authentication, multiple sessions, host-key CA/known_hosts import, and automatic terminal resizing are not implemented.
- The earlier one-shot TCP probe remains available under “Raw TCP transport probe”; it sends no SSH data.

The app only accepts literal RFC1918 IPv4 or IPv6 ULA addresses, port 22, and requires explicit confirmation before opening the socket. It rejects DNS names, public addresses, loopback, link-local, multicast, mapped IPv4-in-IPv6, and alternate ports. This is an app-level restriction: installing an IWA with Direct Sockets grants that application raw TCP capability. The IWA does not provide a general-purpose proxy or listener.

The Go client uses `golang.org/x/crypto/ssh` and a Direct Sockets `ReadableStream`/`WritableStream` adapter. The first fingerprint is TOFU: users must compare it against a trusted value (for example, a fingerprint collected locally from the SSH host) before confirming. Never accept an unexpected key-change alert. The app does not persist credentials or log terminal data.

## Build and sign

Requirements: Node.js 22.13+, Go 1.25+, and Go module access to `golang.org/x/crypto` at build time. The frontend build compiles the SSH client for `GOOS=js GOARCH=wasm`, copies Go's `wasm_exec.js`, then builds the isolated app:

```sh
cd frontend
npm ci
npm run test:iwa-ssh
npm run build:iwa
```

The WASM binary and Go runtime are generated into `browser-iwa/public/` and ignored by git. `npm run package:iwa:unsigned` builds the same app and creates a generic unsigned Web Bundle for archive inspection. That unsigned `.wbn` uses a reserved `.invalid` origin: it is **not an IWA and cannot be installed**, and Direct Sockets cannot run from it.

A real IWA requires a signing key and Chrome's supported signed distribution flow. IWA identity is derived from the signing public key; losing or rotating that key changes the app identity. Keep the private key offline and out of source control.

```sh
openssl genpkey -algorithm Ed25519 -out wrench-iwa.pem
cd frontend
WRENCH_IWA_SIGNING_KEY=/secure/path/wrench-iwa.pem npm run package:iwa
```

The signed bundle is written to `browser-iwa/wrench-browser-iwa.swbn`. The unsigned intermediate is removed. No key or bundle is checked into this repository. Do not distribute the output until the signing key, source revision, and bundle are reviewed.

## Install for development

IWA installation depends on supported Chrome version/platform. Chrome's [IWA developer flow](https://developer.chrome.com/docs/iwa/introduction) requires a supported Chrome/ChromeOS setup and enabling Isolated Web App development mode. In Chrome, enable `chrome://flags/#enable-isolated-web-app-dev-mode`, restart, then use `chrome://web-app-internals` signed bundle installation flow to install the `.swbn`. Follow Chrome's current setup instructions for supported channels/platforms. A normal HTTPS website or unsigned preview package cannot access Direct Sockets. Managed distribution constraints may apply.

## Isolation and existing modes

This code is included only by `frontend/vite.iwa.config.ts` and `browser-iwa/`. It does not change or enter the normal Wrench web frontend, server-side SSH, native Agent, backend routes, SSH egress profiles, or deployed regular frontend. The server/native-Agent flows remain separate.

CI runs the Go target-policy/fingerprint unit tests, frontend tests, regular build isolation check, IWA manifest check, IWA WASM compilation, and unsigned package inspection. These tests do not replace testing the signed app in a supported Chrome IWA environment against a disposable SSH server.
