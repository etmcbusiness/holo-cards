# Holo Cards

My collectible cards shown as retro `.exe` windows: CRT stripes, holo foil, twinkling sparkles, a tilt that follows your mouse or phone, and the character popping out of the frame.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card

1. Put the images in `cards/`:
   - the card scan with the character removed (the base)
   - the character on its own as a transparent PNG (the pop-out)
2. Add an entry to `cards.js`. The comments at the top of that file explain each field.

No build step. Open `index.html` through any static server, for example `npx http-server`.
