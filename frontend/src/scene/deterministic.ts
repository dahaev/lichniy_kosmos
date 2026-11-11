/**
 * Deterministic scene mode for visual snapshots (ARCHITECTURE_MVP_v2 §17.3):
 * `?scene=freeze` in development builds only. Production ignores the flag.
 */
export function isDeterministicScene(search: string): boolean {
  if (!import.meta.env.DEV) return false
  return new URLSearchParams(search).get('scene') === 'freeze'
}
