# Browser-side SSH preview (Chrome Isolated Web App)

The ordinary Wrench website cannot open raw TCP sockets. Chrome [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets) is available to installed Isolated Web Apps (IWAs), not ordinary pages. The separate IWA build now contains an experimental SSH terminal backed by a Go WebAssembly client using `golang.org/x/crypto/ssh`. It connects from the user's browser computer directly to an SSH server on that computer's private network. It does not route SSH traffic through Wrench's backend.

## What works

- Password authentication and an interactive `xterm-256color` shell over Chrome IWA Direct Sockets.
- SSH server public key fingerprint display and local trust-on-first-use (TOFU) pinning. On first connection, verify the fingerprint through a separate trusted channel before accepting. The pin is stored in this IWA origin's local storage, isolated from ordinary Wrench pages and other IWAs. A changed fingerprint is refused unless the user explicitly verifies it out of band and confirms a pin-renewal prompt showing both old and new fingerprints. Clearing this app's browser storage clears those pins.
- One active SSH shell per IWA window. Password authentication and local private-key authentication are supported. The private-key picker accepts files up to 64 KiB; supported key types are Ed25519, ECDSA, and RSA with SHA-2 signatures. Unencrypted keys and encrypted OpenSSH/PEM keys with a passphrase are supported. The key and passphrase are read locally, passed to the browser WASM SSH client, and cleared from the form and temporary byte buffers after authentication; browser runtimes cannot guarantee secure erasure of all copies. The private key is never sent to the server, though SSH public-key authentication necessarily sends its public key and authentication signatures. The SFTP panel lists directories, uploads and downloads regular files, creates directories, renames entries, and deletes files or empty directories over a subsystem on the same authenticated, host-key-pinned SSH connection. Transfers are limited to 16 MiB, listings return at most 500 entries and time out after 10 seconds, uploads and renames refuse to overwrite, remote `..` traversal is rejected, downloads reject symlinks, symlinks cannot be navigated, and deletes of non-empty directories fail. Upload and directory permissions use server defaults. Path validation is not a remote filesystem sandbox: the SSH account can still access any path its server-side permissions allow. Multiple sessions, host-key CA/known_hosts import, and automatic terminal resizing are not implemented.
- The earlier one-shot TCP probe remains available under “Raw TCP transport probe”; it sends no SSH data.

The app only accepts literal RFC1918 IPv4 or IPv6 ULA addresses and port 22. Pressing Connect is the explicit action to open one socket to the displayed target; Chrome may also ask you to grant this IWA Local Network permission. The app rejects DNS names, public addresses, loopback, link-local, multicast, mapped IPv4-in-IPv6, and alternate ports. This is an app-level restriction: installing an IWA with Direct Sockets grants that application raw TCP capability. The IWA does not provide a general-purpose proxy or listener.

The Go client uses `golang.org/x/crypto/ssh` with explicit modern KEX, cipher, MAC, and host-key allowlists (Ed25519, ECDSA, and RSA/SHA-2; no RSA/SHA-1, DSA, SHA-1 KEX, CBC, or RC4), over a Direct Sockets `ReadableStream`/`WritableStream` adapter. Interoperability tests exercise Ed25519, ECDSA P-256, and RSA keys. Servers offering only legacy SHA-1, DSA, CBC, or RC4 algorithms will be rejected. The first fingerprint is TOFU: users must compare it against a trusted value (for example, a fingerprint collected locally from the SSH host) before confirming. Never accept an unexpected key-change alert. The app does not persist credentials or log terminal data. Passwords, selected key files, and passphrases are held only for the active browser interaction and are cleared from the form after successful authentication or disconnect; JavaScript/WASM cannot promise secure erasure of all runtime copies.

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

IWA installation depends on supported Chrome version/platform. Chrome's [IWA developer flow](https://developer.chrome.com/docs/iwa/introduction) documents Chrome/ChromeOS 120+; current Chrome channel and platform restrictions still apply. The local development proxy below is only for testing trusted local code. It does not produce a signed, redistributable IWA.

```sh
cd frontend
npm ci
npm run build:iwa
cd ../browser-iwa/dist
python3 -m http.server 8000 --bind 127.0.0.1
```

In Chrome, enable `chrome://flags/#enable-isolated-web-apps` and `chrome://flags/#enable-isolated-web-app-dev-mode`, restart, open `chrome://web-app-internals`, and choose **Install IWA via Dev Mode Proxy** with `http://localhost:8000/`. Keep this server bound to loopback and stop it after testing. The dev proxy assigns a temporary development identity; it is not the production signed identity.

On first private-network connection, grant the IWA's Local Network permission in Chrome if prompted. If the TCP connection remains pending, inspect the installed app's Local Network permission in Chrome's app/site settings. Then enter an RFC1918/ULA SSH address and press Connect. The earlier Dev Mode Proxy smoke test verified TCP/SSH authentication, first-use fingerprint confirmation, shell output, and terminal input/output after CDP granted `localNetwork`; it did not exercise signed-bundle installation. The signed-bundle procedure and its native-permission-UI caveat are documented below.

For signed distribution, download the `.swbn`, `.sha256`, and `RELEASE-METADATA.txt` from the published GitHub Release assets or the `wrench-browser-iwa-release` artifact of a successful workflow. Verify with `sha256sum -c wrench-browser-iwa.swbn.sha256`. Then follow Chrome's current **Install IWA from Signed Web Bundle** instructions using `chrome://web-app-internals` on a supported channel/platform. A normal HTTPS website or unsigned preview package cannot access Direct Sockets. Managed distribution constraints may apply.

## Reproduce the signed Chromium smoke test

The automated harness is available as `npm run test:iwa-signed-smoke` and as the manual GitHub Actions workflow **Signed IWA Chromium smoke test**. It creates ephemeral Ed25519 signing and SSH host keys plus an encrypted SSH user key, builds and signs a test-only IWA, and installs that signed IWA into a newly created temporary Chromium profile. It verifies that an ungranted Local Network permission blocks the socket, then uses CDP to grant permission and checks password login and encrypted private-key login, first-use fingerprint confirmation, terminal input/output, SFTP list/upload/download/rename/delete/mkdir, and host-key renewal after rotating the SSH host key. The key passphrase is sent to the helper through stdin rather than a process argument. It removes its temporary profile, keys, signed bundle, helper binary, child processes, and IWA build outputs it created on exit. It refuses to overwrite pre-existing generated IWA outputs. It neither reads nor uses the production signing secret and does not upload or publish an artifact. The test server binds only to port 22 on an RFC1918 address assigned to the test machine; it refuses other address ranges.

Requirements: Linux, Node.js 22, Go 1.25+, OpenSSL, Chromium with IWA developer-mode installation support, an RFC1918 IPv4 address, a free TCP port 22 on that address, and Playwright from `npm ci`. On a headless host, run with `xvfb-run`. The harness fails when these capabilities are unavailable; it does not silently skip the permission or SSH checks. Only in a disposable root container where Chromium cannot use namespaces, set `WRENCH_IWA_CHROMIUM_NO_SANDBOX=1`; this disables Chromium sandboxing and must not be used with a normal desktop profile. `WRENCH_IWA_CHROMIUM` can select the Chromium executable.

```sh
cd frontend
npm ci
xvfb-run -a npm run test:iwa-signed-smoke
```

The optional manual workflow uses the current Chrome channel, a fresh profile and temporary key, and has only `contents: read`; it requires no GitHub environment, signing secret, or release permissions. Chromium sandboxing remains enabled on the hosted runner.

The signed browser smoke test was run on **Chromium 152.0.7977.82, Debian 12**. Chrome's general IWA documentation lists Chrome/ChromeOS 120+ for the IWA developer flow, but this project has only verified its current `local-network` permission behavior on that Chromium 152 build. Other versions/platforms need their own verification. Direct Sockets runs from the installed `isolated-app://` origin; a regular HTTPS page, `localhost` web page, or unsigned `.wbn` is not a substitute.

The following makes a disposable signing identity and Chrome profile. It writes the signed bundle to the ignored workspace path temporarily and removes it, the profile, and the key when the shell exits. Run it only for local development; never use this ephemeral key for a release or compare its app origin with the production identity.

```sh
cd frontend
npm ci
local_iwa_test_dir=$(mktemp -d /tmp/wrench-iwa-signed-smoke.XXXXXX)
chmod 700 "$local_iwa_test_dir"
if test -e ../browser-iwa/wrench-browser-iwa.swbn; then
  echo 'Refusing to replace an existing signed bundle; use a clean disposable checkout.' >&2
  exit 1
fi
trap 'rm -f ../browser-iwa/wrench-browser-iwa.swbn; rm -rf "$local_iwa_test_dir"' EXIT
openssl genpkey -algorithm Ed25519 -out "$local_iwa_test_dir/ephemeral.pem"
chmod 600 "$local_iwa_test_dir/ephemeral.pem"
WRENCH_IWA_SIGNING_KEY="$local_iwa_test_dir/ephemeral.pem" npm run package:iwa
bundle_id=$(./node_modules/.bin/wbn-dump-id --with-iwa-scheme --key "$local_iwa_test_dir/ephemeral.pem")
profile="$local_iwa_test_dir/chrome-profile"
mkdir -p "$profile"
printf '%s\n' '{"browser":{"enabled_labs_experiments":["enable-isolated-web-app-dev-mode@1","enable-isolated-web-apps@1"]}}' > "$profile/Local State"
chmod 600 "$profile/Local State"
printf 'Temporary directory: %s\nBundle origin: %s\n' "$local_iwa_test_dir" "$bundle_id"
```

Keep this terminal open so its cleanup trap runs when Chromium exits. The browser launch runs in the foreground; use a second terminal if you need to inspect the app over CDP. Launch the disposable browser with the install-from-file developer switch. On this container the command needs Xvfb and `--no-sandbox` because unprivileged user namespaces are disabled; use a normally sandboxed Chromium on a desktop instead of copying that container-only flag into a daily-use profile.

```sh
xvfb-run -a /usr/bin/chromium \
  --no-sandbox --disable-dev-shm-usage \
  --user-data-dir="$profile" --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check \
  --install-isolated-web-app-from-file="$(pwd)/../browser-iwa/wrench-browser-iwa.swbn" \
  about:blank
```

Confirm installation in `chrome://web-app-internals`; its installed bundle path should end in `main.swbn`. Open the installed app from Chrome's app launcher, or attach Playwright to `http://127.0.0.1:9222` and navigate a page to `bundle_id`. In the page verify `isSecureContext` and `crossOriginIsolated` are true, `typeof TCPSocket` is `function`, and the `direct-sockets` and `local-network` policies are allowed. Use a disposable SSH account on an RFC1918/ULA IP, port 22. Compare the displayed host-key fingerprint through a separate trusted channel before confirming it. Verify `ready` appears, type a unique string in the terminal and confirm it echoes, then disconnect. In the tested setup this verified password login, first-use trust prompt, shell output/input, and a changed-host-key renewal prompt.

### Local Network permission test caveat

The automated permission-gate check used Playwright/CDP against the signed installed IWA origin. It reset the origin's browser permission and observed `navigator.permissions.query({name: 'local-network'}) === 'prompt'`. With the permission ungranted, Connect timed out and an accept-counting SSH server observed **zero TCP connections**. The test then called `Browser.grantPermissions({origin, permissions: ['localNetwork']})`; the permission became `granted`, and the SSH connection/terminal test passed. This proves the IWA's permission-policy and socket gate in Chromium. The smoke test resets the permission to `prompt`, verifies the denied socket attempt, and then CDP programmatically grants permission. It does **not** verify whether Chromium displays the native Local Network permission prompt or how a user grants it through Chrome's UI; the native permission UI remains unverified. The local run described here used root-only Debian 12 with Xvfb and the disposable-container `--no-sandbox` opt-in, without an interactive desktop or native UI click-through. Verify prompt display and user grant separately in an interactive, normally sandboxed Chrome session before documenting that behavior as tested. Do not report the native prompt as tested based on this procedure.

## Isolation and existing modes

This code is included only by `frontend/vite.iwa.config.ts` and `browser-iwa/`. It does not change or enter the normal Wrench web frontend, server-side SSH, native Agent, backend routes, SSH egress profiles, or deployed regular frontend. The server/native-Agent flows remain separate.

CI runs the Go target-policy/fingerprint and SSH handshake tests, frontend tests, regular build isolation check, IWA manifest check, and a Go/WASM integration test. The integration test launches the compiled WASM client against a local SSH test server through a stream-compatible TCP socket shim and verifies host-key callback, password auth, PTY shell startup, input, and output. The Go unit test and signed Chromium smoke additionally exercise encrypted private-key authentication. CI also compiles the IWA and inspects the unsigned package. The shim test does not exercise Chrome's actual Direct Sockets implementation; verify the signed app in supported Chrome against a disposable SSH server before distribution.
