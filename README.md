# Holo Cards

My collectible cards with a 3D lenticular feel: tilt with your mouse or phone and the stripes slide, the colours split, the foil and sparkles shimmer, and the character floats out of the card in front of it.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card

1. Put the images in `cards/`:
   - the card scan with the character removed (the base)
   - the character on its own as a transparent PNG (the pop-out)
2. Add an entry to `cards.js`. The comments at the top of that file explain each field.

No build step. Open `index.html` through any static server, for example `npx http-server`.
