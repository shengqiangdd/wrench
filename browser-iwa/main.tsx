import React from 'react'
import { createRoot } from 'react-dom/client'
import BrowserDirectTcpProbe from '../frontend/src/modules/settings/BrowserDirectTcpProbe'
import '../frontend/src/index.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-950 p-6 text-slate-100">
      <h1 className="mb-4 text-xl font-semibold">Wrench browser TCP preview</h1>
      <p className="mb-4 text-sm text-slate-400">
        Experimental Chrome Isolated Web App. This page only tests one confirmed private-network TCP connection. It is not an SSH client.
      </p>
      <BrowserDirectTcpProbe />
      <p className="mt-6 text-xs text-slate-500">Do not install bundles unless you trust their signing key and source.</p>
    </main>
  </React.StrictMode>,
)
