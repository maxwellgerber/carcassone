// Player preferences that survive reloads (localStorage), read all over the client.
export const PREF_OWNERS = 'carcassonne.showOwners';
export let showOwners = (() => { try { return localStorage.getItem(PREF_OWNERS) === 'on'; } catch { return false; } })();
export function setShowOwners(v: typeof showOwners): void { showOwners = v; }

export const PREF_ANIMATE = 'carcassonne.animate';
export let animateMeeples = (() => { try { return localStorage.getItem(PREF_ANIMATE) !== 'off'; } catch { return true; } })();
export function setAnimateMeeples(v: typeof animateMeeples): void { animateMeeples = v; }
