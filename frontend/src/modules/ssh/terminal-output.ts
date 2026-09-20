/** Whether the initial connection status line can be cleared safely. */
export function shouldClearInitialTerminal(hasPtyOutput: boolean): boolean {
  return !hasPtyOutput
}

/** Decode PTY bytes without corrupting UTF-8 sequences split across WebSocket frames. */
export function decodePtyBytes(decoder: TextDecoder, bytes: Uint8Array): string {
  return decoder.decode(bytes, { stream: true })
}
