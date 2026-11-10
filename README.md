# Holo Cards

My collectible cards as little holograms: the card barely tilts, glitter in the art window slides at different depths, and the character sits just in front of the card on a gentle curve.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card on the page

Tap **+ Add card** and pick one photo or scan of the card. The page then:

1. crops the card out of whatever is around it
2. finds the art window (where the glitter goes)
3. cuts the character out with Segment Anything (SlimSAM, about 14 MB, downloaded once)
4. paints the character out of the card and gives the cut-out the puffed, banded 3D look
5. places it a little bigger than before, feet fixed, so it breaks out of the frame

If a part is missing (a wing, a tail), tap it; switch to "Tapping removes" to take out a wrong bit. You can also drag the character or the edges of the art window. Cards added this way are kept in that browser only.

## Adding a built-in card

Put the processed images in `cards/` and add an entry to `cards.js` (the comments there explain each field). No build step; serve the folder with any static server, e.g. `npx http-server`.
