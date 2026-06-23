/// <reference types="vite/client" />

declare module 'xterm-addon-fit' {
  import { ITerminalAddon, Terminal } from 'xterm'
  export class FitAddon implements ITerminalAddon {
    activate(terminal: Terminal): void
    dispose(): void
    fit(): void
    proposeDimensions(): { cols: number; rows: number }
  }
}

declare module 'xterm-addon-web-links' {
  import { ITerminalAddon, Terminal } from 'xterm'
  export class WebLinksAddon implements ITerminalAddon {
    constructor(handler?: (event: MouseEvent, uri: string) => void)
    activate(terminal: Terminal): void
    dispose(): void
  }
}

declare module 'xterm-addon-search' {
  import { ITerminalAddon, Terminal } from 'xterm'
  export class SearchAddon implements ITerminalAddon {
    activate(terminal: Terminal): void
    dispose(): void
    findNext(text: string): boolean
    findPrevious(text: string): boolean
  }
}
