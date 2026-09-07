

export interface MeInfo { signedIn: boolean; sub: string | null; name: string | null; devMode: boolean; }
export let me: MeInfo = { signedIn: false, sub: null, name: null, devMode: false };

export async function refreshMe(): Promise<MeInfo> {
  const res = await fetch('/api/me');
  me = await res.json();
  return me;
}
