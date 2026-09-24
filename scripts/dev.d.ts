export function resolveDevHome(flag?: string): string
export function resolveDshEntry(): string
export function parseDevArgs(argv: readonly string[]): { homeFlag?: string, port: string, noOpen: boolean }
