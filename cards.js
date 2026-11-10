// Your cards. Add one entry per card and drop its images in cards/.
//
//   name   used for the page title
//   art    the card scan with the character removed (any size)
//   pop    the character cut out on a transparent PNG; it is puffed up into
//          a 3D shape that stands out of the card
//            box    [left, top, width] in % of the card (height follows the
//                   image); may go below 0 or past 100 to stick out
//            cut    the line (% of the card height) where the character sinks
//                   into the card, e.g. the bottom of the art box
//            float  true makes it bob gently
window.CARDS = [
  {
    name: 'Crystal Charizard',
    art: 'cards/crystal-charizard.jpg',
    pop: { src: 'cards/crystal-charizard-pop.png', box: [1, 4.4, 93.7], cut: 48.5, float: true },
  },
];
