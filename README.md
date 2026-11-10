# Holo Cards

My collectible cards as little holograms: the card barely tilts, glitter in the art window slides at different depths, and the character sits just in front of the card on a gentle curve.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card on the page

Tap **+ Add card** and pick one image with the card (character removed) on one side and the cut-out character on the other, on a checkerboard or plain background. The page splits them, gives the character the puffed, banded 3D look and centres it on the art window a little larger, so it breaks out of the frame. Drag or resize the character, or drag the edges of the art window, then save. Cards added this way are kept in that browser only.

## Adding a built-in card

Put the processed images in `cards/` and add an entry to `cards.js` (the comments there explain each field). No build step; serve the folder with any static server, e.g. `npx http-server`.
