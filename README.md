# Holo Cards

My collectible cards as little holograms: the card barely tilts, glitter in the art window slides at different depths, and the character sits just in front of the card on a gentle curve.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card on the page

Tap **+ Add card** and pick two images:

1. the card with the character removed
2. the character on its own (a transparent PNG, or a JPG on a checkerboard or plain background; the background is removed for you)

The character gets the puffed, banded shading automatically. Drag it into place, set its size, drag the dashed line to where it should fade into the card, and save. Cards added this way are kept in that browser only.

## Adding a built-in card

Put the processed images in `cards/` and add an entry to `cards.js` (the comments there explain each field). No build step; serve the folder with any static server, e.g. `npx http-server`.
