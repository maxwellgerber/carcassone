// Client entry point: wires the skin system and the router, then kicks off the
// first render once tile art is decoded. Everything else lives in its own module.
import { preloadTileArt } from './art.js';
import { onSkinChange, applySkinToDocument } from './skins/index.js';
import { route } from './router.js';
import './hooks.js'; // window.__carcassonne, for the browser playthrough script
import { renderRoom, room } from './room.js';

onSkinChange(() => { if (room) renderRoom(); else route(); });
applySkinToDocument();

// Tile art is decoded from inline SVG data: URIs before the very first render —
// this is well under a frame for 22 small images, and it means drawBoard() (which
// runs synchronously off mouse events) never has to handle a not-yet-loaded image.
preloadTileArt()
  .catch((err) => { console.error('Tile art failed to preload:', err); })
  .then(() => route());
