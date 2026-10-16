declare module 'gltf-validator' {
  export function validateBytes(data: Uint8Array, options?: Record<string, unknown>): Promise<{
    issues: { numErrors: number; numWarnings: number; messages: unknown[] };
  }>;
}
