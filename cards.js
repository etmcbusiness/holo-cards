// Your cards. Add one entry per card and drop its images in cards/.
//
//   name   used for the page title and alt text
//   art    the card scan with the character removed (any size)
//   holo   [left, top, width, height] in % of the card: the art window, where
//          the hologram glitter goes
//   pop    the character cut out on a transparent PNG, bent into a gentle
//          curve just in front of the card. Its bottom should already fade
//          out where it meets the bottom of the art window.
//            box    [left, top, width, height] in % of the card; may go
//                   below 0 or past 100 to stick out past the edge
window.CARDS = [
  {
    name: 'Crystal Charizard',
    art: 'cards/crystal-charizard.jpg',
    holo: [10, 11.8, 86, 36.6],
    pop: { src: 'cards/crystal-charizard-pop.png', box: [1, 4.4, 93.7, 68.3] },
  },
];
