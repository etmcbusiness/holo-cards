// Your cards. Add one entry per card and drop its images in cards/.
//
//   name   used for the page title and alt text
//   art    the card scan with the character removed (any size)
//   pop    the character cut out on a transparent PNG, floating in front
//            box    [left, top, width, height] in % of the card; may go
//                   below 0 or past 100 to stick out past the edge
//            cut    hide the cut-out below this line (% of the card height),
//                   e.g. the bottom of the art box, so it climbs out of it
//            float  true makes it bob gently on its own
window.CARDS = [
  {
    name: 'Crystal Charizard',
    art: 'cards/crystal-charizard.jpg',
    pop: { src: 'cards/crystal-charizard-pop.png', box: [1, 4.4, 93.7, 68.3], cut: 48.5, float: true },
  },
];
