// Built-in cards. Add one entry per card and drop its images in cards/.
// (Cards can also be added from the page with "+ Add card"; those stay on that device.)
//
//   name     used for the page title and alt text
//   art      the card scan (any size)
//   holo     [left, top, width, height] in % of the card: the art window, where the
//            hologram glitter goes
//   glitter  the glitter's colours as hues in degrees, picked from the card's art;
//            false for a non-holo card (no glitter, sparkles or foil)
//   pop      the character cut out on a transparent PNG, bent into a gentle curve just
//            in front of the card. Its bottom should already fade out where it meets the
//            bottom of the art window.
//              box  [left, top, width, height] in % of the card; may go below 0 or past
//                   100 to stick out past the edge
window.CARDS = [
  {
    name: 'Crystal Charizard',
    art: 'cards/crystal-charizard.jpg',
    holo: [10, 11.8, 86, 36.6],
    glitter: [45, 225, 195, 15],
    pop: { src: 'cards/crystal-charizard-pop.png', box: [1, 4.4, 93.7, 68.3] },
  },
  {
    name: 'Base Set Charizard',
    art: 'cards/base-charizard.jpg',
    holo: [11.3, 11.1, 79, 40.7],
    glitter: [45, 15],
    pop: { src: 'cards/base-charizard-pop.png', box: [7.4, 12.1, 85.1, 42.3] },
  },
];
