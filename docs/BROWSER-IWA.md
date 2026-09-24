# Browser TCP preview (Chrome Isolated Web App)

The ordinary Wrench web page cannot open raw TCP sockets. Chrome [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets) is exposed to installed Isolated Web Apps (IWAs), not regular pages. This repository now has an independent IWA shell containing the TCP probe. The regular Wrench web build does not include or expose this feature.

## Scope and current status

This is a transport smoke test, not an SSH implementation. The app accepts only RFC1918 IPv4 or IPv6 ULA address literals on TCP port 22. It asks for confirmation for each attempt, opens one socket, sends no bytes, and closes it. It does not perform SSH negotiation, check or pin a host key, authenticate, start a terminal, or provide SFTP. The regular Wrench page remains unchanged and does not include this probe; only the separate IWA build contains it. This work adds no backend route and does not change the deployed regular frontend, server-side SSH behavior, egress profile/policy, or existing server/native-Agent modes.

There is no browser SSH protocol stack wired to Direct Sockets in this repository. The existing Rust `russh` client is used by native/server code and is not currently compiled and integrated as an IWA/WASM SSH client. A real browser SSH implementation still needs protocol negotiation, mandatory host-key verification, authentication UI that keeps credentials local, and terminal/session lifecycle integration. This scaffold intentionally does not claim those features.

The destination check is an app-level guard, not a browser-enforced network boundary. Direct Sockets grants the installed IWA raw TCP capability. Install only a bundle built from reviewed source and signed with a trusted key. The probe intentionally does not resolve names, accept public/loopback/link-local addresses, allow alternate ports, or expose a proxy/listener.

## Build and sign

Use Node.js 22.13 or newer. IWA bundle identity is derived from the signing public key; losing or rotating that key changes the app identity. Keep the private key offline and out of source control.

```sh
openssl genpkey -algorithm Ed25519 -out wrench-iwa.pem
cd frontend
WRENCH_IWA_SIGNING_KEY=/secure/path/wrench-iwa.pem npm run package:iwa
```

The signed bundle is written to `browser-iwa/wrench-browser-iwa.swbn`. The unsigned intermediate is removed. Do not publish the output until the signing key, source revision, and bundle are reviewed. No key or bundle is checked into this repository.

For a keyless packaging check, run `npm run package:iwa:unsigned` from `frontend`. It creates `browser-iwa/wrench-browser-iwa-preview-unsigned.wbn` using a reserved `.invalid` HTTPS origin. This generic unsigned Web Bundle is only for inspecting the archive contents; it is **not an IWA and cannot be installed**. The Direct Sockets capability is unavailable under that HTTPS origin. A real IWA bundle requires a signing key and Chrome's supported signed distribution flow.

## Install for development

IWA availability and installation are Chrome-version/platform dependent. Chrome's [IWA developer flow](https://developer.chrome.com/docs/iwa/introduction) requires a supported Chrome/ChromeOS setup and enabling Isolated Web App development mode. In Chrome, enable `chrome://flags/#enable-isolated-web-app-dev-mode`, restart, then open `chrome://web-app-internals` and use its signed bundle installation flow to install the `.swbn` file. Follow Chrome's current IWA setup instructions for the exact channel/platform requirements. Production deployment is not equivalent to publishing a normal website; managed ChromeOS distribution and policy/early-access constraints may apply.

This app opens as its own installed application window. It does not replace the normal Wrench page or alter server/native-Agent connection modes.

## Automated checks

`npm run build:iwa` compiles the IWA shell without requiring any signing key. Frontend CI runs this build and unit tests cover target validation, capability detection, explicit approval, socket closure, and manifest policy declarations. A successful build does not prove Chrome installation or device-level Direct Sockets behavior; test the signed bundle in the intended Chrome environment before distributing it.
