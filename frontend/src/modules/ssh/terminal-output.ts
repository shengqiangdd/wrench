/** Whether the initial connection status line can be cleared safely. */
export function shouldClearInitialTerminal(hasPtyOutput: boolean): boolean {
  return !hasPtyOutput
}
