# Holo Cards

My collectible cards as little holograms: the card barely tilts, glitter in the art window slides at different depths, and the character sits just in front of the card on a gentle curve.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card on the page

Tap **+ Add card**; the photo gallery opens. Pick either:

- **a plain photo or scan of the card.** Google Gemini (your own API key, asked for once and kept only on that device) paints the character out of the card and isolates it in place. A few cents per card.
- **one image with the card (character removed) and the cut-out side by side,** on a checkerboard or plain background. No AI needed.

The character gets the puffed, banded 3D look and is placed so it breaks out of the frame; glitter is matched to the card (or turned off for non-holo cards). Drag or resize it if needed, then save. Cards added this way are kept in that browser only.

## Adding a built-in card

Put the processed images in `cards/` and add an entry to `cards.js` (the comments there explain each field). No build step; serve the folder with any static server, e.g. `npx http-server`.
