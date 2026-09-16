// Vite 8 + @vitejs/plugin-react v6: refresh preamble fix
//
// In non-bundled dev mode, the OXC transform adds `$RefreshSig$()` / `$RefreshReg$()`
// calls but the preamble script is not injected — so the shim defines them here.
//
// 说明：这段代码以前是 index.html 里的**内联脚本**。内联脚本会迫使 CSP 打开
// `script-src 'unsafe-inline'`，而后者正是 XSS 最常用的入口。挪成外部文件后，
// CSP 可以只允许 `'self'`，同时开发模式行为完全不变（生产环境它只是个空操作）。
if (!window.$RefreshSig$) window.$RefreshSig$ = function () { return function (t) { return t; }; };
if (!window.$RefreshReg$) window.$RefreshReg$ = function () {};
