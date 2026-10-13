// Converting file:// URLs is outside the scope of string-only linting.
export function fileURLToPath(_url: unknown): never {
  throw new Error('Unsupported Node URL API: fileURLToPath');
}
