# Holo Cards

My collectible cards as little holograms: the card barely tilts, glitter in the art window slides at different depths, and the character sits just in front of the card on a gentle curve.

Live page: https://etmcbusiness.github.io/holo-cards/

## Adding a card on the page

Tap **+ Add card**; the photo gallery opens. Pick either (photos can be at an angle on a table, or screenshots; the card is found, straightened and cropped automatically):

- **a plain photo or scan of the card.** Google Gemini (your own API key, asked for once and kept only on that device) outlines the character; it is cut from the card's own pixels (nothing is redrawn) and the space behind it is filled in on the phone. If that fails, Gemini repaints the card instead. About a cent per card.
- **one image with the card (character removed) and the cut-out side by side,** on a checkerboard or plain background. No AI needed.

The character gets the puffed, banded 3D look and is placed so it breaks out of the frame; glitter is matched to the card (or turned off for non-holo cards). Drag or resize it if needed, then save. Cards added this way are kept in that browser only.

Works for any trading card (Pokémon, Magic, Yu-Gi-Oh, One Piece, sports…). Gemini finds the art window, so full-art cards keep the whole character. Holo cards shine only in the art window, reverse holos everywhere except it. Each card gets a gentle background animation that suits its picture (embers, bubbles, leaves, snow…).

## Value

Tap the value under a card. A graded card (PSA, BGS, CGC…) is looked up at its grade; a raw card gets an estimated condition 1-10 from the photo and is looked up raw in that condition. Gemini searches recent sold listings and shows the last sale, recent sales and sources. Change the grade or type a value by hand any time. A new card is looked up automatically when it is saved.

## Adding a built-in card

Put the processed images in `cards/` and add an entry to `cards.js` (the comments there explain each field). No build step; serve the folder with any static server, e.g. `npx http-server`.
