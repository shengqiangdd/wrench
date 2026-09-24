# Browser-side SSH preview (Chrome Isolated Web App)

The ordinary Wrench website cannot open raw TCP sockets. Chrome [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets) is available to installed Isolated Web Apps (IWAs), not ordinary pages. The separate IWA build now contains an experimental SSH terminal backed by a Go WebAssembly client using `golang.org/x/crypto/ssh`. It connects from the user's browser computer directly to an SSH server on that computer's private network. It does not route SSH traffic through Wrench's backend.

## What works

- Password authentication and an interactive `xterm-256color` shell over Chrome IWA Direct Sockets.
- SSH server public key fingerprint display and local trust-on-first-use (TOFU) pinning. On first connection, verify the fingerprint through a separate trusted channel before accepting. The pin is stored in this IWA origin's local storage, isolated from ordinary Wrench pages and other IWAs. A changed fingerprint is refused unless the user explicitly verifies it out of band and confirms a pin-renewal prompt showing both old and new fingerprints. Clearing this app's browser storage clears those pins.
- Password is only held in the page/Go WebAssembly memory for the connection and cleared from the form after successful login. It is not saved or sent to Wrench servers.
- One active SSH shell per IWA window. SFTP, private-key authentication, multiple sessions, host-key CA/known_hosts import, and automatic terminal resizing are not implemented.
- The earlier one-shot TCP probe remains available under “Raw TCP transport probe”; it sends no SSH data.

The app only accepts literal RFC1918 IPv4 or IPv6 ULA addresses, port 22, and requires explicit confirmation before opening the socket. It rejects DNS names, public addresses, loopback, link-local, multicast, mapped IPv4-in-IPv6, and alternate ports. This is an app-level restriction: installing an IWA with Direct Sockets grants that application raw TCP capability. The IWA does not provide a general-purpose proxy or listener.

The Go client uses `golang.org/x/crypto/ssh` with explicit modern KEX, cipher, MAC, and host-key allowlists (Ed25519, ECDSA, and RSA/SHA-2; no RSA/SHA-1, DSA, SHA-1 KEX, CBC, or RC4), over a Direct Sockets `ReadableStream`/`WritableStream` adapter. Interoperability tests exercise Ed25519, ECDSA P-256, and RSA keys. Servers offering only legacy SHA-1, DSA, CBC, or RC4 algorithms will be rejected. The first fingerprint is TOFU: users must compare it against a trusted value (for example, a fingerprint collected locally from the SSH host) before confirming. Never accept an unexpected key-change alert. The app does not persist credentials or log terminal data.

## Build and sign

Requirements: Node.js 22.13+, Go 1.25+, and Go module access to `golang.org/x/crypto` at build time. The frontend build compiles the SSH client for `GOOS=js GOARCH=wasm`, copies Go's `wasm_exec.js`, then builds the isolated app:

```sh
cd frontend
npm ci
npm run test:iwa-ssh
npm run build:iwa
npm run test:iwa-wasm
```

The WASM binary and Go runtime are generated into `browser-iwa/public/` and ignored by git. `npm run package:iwa:unsigned` builds the same app and creates a generic unsigned Web Bundle for archive inspection. That unsigned `.wbn` uses a reserved `.invalid` origin: it is **not an IWA and cannot be installed**, and Direct Sockets cannot run from it.

A real IWA requires a signing key and Chrome's supported signed distribution flow. IWA identity is derived from the signing public key; losing or rotating that key changes the app identity. Keep an offline backup and never put the key in source control. If using automated signing, provide the key only through the protected `iwa-signing` Actions environment. Do not create a new key for an established IWA; doing so creates a different app identity.

```sh
openssl genpkey -algorithm Ed25519 -out wrench-iwa.pem
cd frontend
WRENCH_IWA_SIGNING_KEY=/secure/path/wrench-iwa.pem npm run package:iwa
```

The signed bundle is written to `browser-iwa/wrench-browser-iwa.swbn`. The unsigned intermediate is removed. No key or bundle is checked into this repository. Do not distribute the output until the signing key, source revision, and bundle are reviewed.

### Signed release artifact

The `Release Browser SSH IWA` workflow requires the `WRENCH_IWA_SIGNING_KEY` secret and `WRENCH_IWA_BUNDLE_ID` variable in a GitHub Actions environment named `iwa-signing`; the secret value must be the PEM contents, not a local path. The variable pins the expected `isolated-app://.../` origin derived from the same key. The workflow checks the key against this pin before signing, so an accidental key change fails closed. It runs the frontend and SSH client checks, builds and signs the IWA, records its bundle identity and SHA-256, uploads a 90-day `wrench-browser-iwa-release` workflow artifact, and attaches the bundle, checksum, and metadata to the GitHub Release. On ordinary non-immutable releases, it attaches the assets after publication. If immutable releases are enabled, create a draft release first, then use Actions → Release Browser SSH IWA → Run workflow with that draft's tag; the workflow attaches assets to the draft, which you can then publish. The publish-triggered run verifies the existing assets rather than replacing them. Partial or mismatched asset sets fail closed; the workflow never deletes existing assets. Configure the environment to allow only the protected default branch used for manual workflow runs and approved release tags, and require an authorized reviewer before exposing the signing secret. Derive the initial public ID with `frontend/node_modules/.bin/wbn-dump-id --with-iwa-scheme --key /secure/path/wrench-iwa.pem` and review it before setting the variable. This workflow signs with one key and does not implement Chrome's multi-key IWA key-rotation process. Do not bypass an ID mismatch by changing the pin when replacing the key; that creates a different IWA identity. A planned rotation must follow [Chrome's supported key-rotation procedure](https://developer.chrome.com/docs/iwa/key-rotation), retaining the existing bundle ID while introducing the replacement key. The workflow writes the secret to a mode-restricted temporary file and removes it at job end. Keep an offline key backup. This workflow does not create a signing key or publish an unsigned bundle as an installable app.

## Install for development

IWA installation depends on supported Chrome version/platform. Chrome's [IWA developer flow](https://developer.chrome.com/docs/iwa/introduction) documents Chrome/ChromeOS 120+ and the supported installation path; current Chrome channel and platform restrictions still apply. Download the `.swbn` and `.sha256` either from the published GitHub Release assets or the `wrench-browser-iwa-release` artifact of a successful release workflow. Verify the checksum with `sha256sum -c wrench-browser-iwa.swbn.sha256` (or the matching platform tool) before installation. For development installation, enable `chrome://flags/#enable-isolated-web-app-dev-mode`, restart Chrome, then open `chrome://web-app-internals` and use **Install IWA from Signed Web Bundle**. Follow Chrome's current setup instructions for supported channels/platforms. A normal HTTPS website or unsigned preview package cannot access Direct Sockets. Managed distribution constraints may apply.

## Isolation and existing modes

This code is included only by `frontend/vite.iwa.config.ts` and `browser-iwa/`. It does not change or enter the normal Wrench web frontend, server-side SSH, native Agent, backend routes, SSH egress profiles, or deployed regular frontend. The server/native-Agent flows remain separate.

CI runs the Go target-policy/fingerprint and SSH handshake tests, frontend tests, regular build isolation check, IWA manifest check, and a Go/WASM integration test. The integration test launches the compiled WASM client against a local SSH test server through a stream-compatible TCP socket shim and verifies host-key callback, password auth, PTY shell startup, input, and output. CI also compiles the IWA and inspects the unsigned package. The shim test does not exercise Chrome's actual Direct Sockets implementation; verify the signed app in supported Chrome against a disposable SSH server before distribution.
