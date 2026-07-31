// Demo (practice) records use fixed IDs prefixed with "demo-" — see the API
// server's demo-data route. Used to badge demo rows in lists that only have
// ids/names (e.g. rate tables) without extra requests.
export function isDemoId(id: string): boolean {
  return id.startsWith('demo-');
}
