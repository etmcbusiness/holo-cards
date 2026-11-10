// Your cards. Add one entry per card and drop its images in cards/.
//
//   name     shown in the title bar as "<name>.exe"
//   color    title-bar colour (the card's type colour)
//   icon     small emoji in the title-bar corner
//   art      the card scan or art (any aspect ratio). For the pop-out,
//            use a version with the character removed.
//   rounded  true if the art is a whole card scan (rounds its corners)
//   caption  flavour text along the bottom
//   pop      optional: the character cut out on a transparent PNG, floating
//            in front of the card.
//              box    [left, top, width, height] in % of the art; may go
//                     below 0 or past 100 to stick out of the window
//              cut    hide the cut-out below this line (% of the art height),
//                     e.g. the bottom of the art box, so it climbs out of it
//              float  true makes it bob gently on its own
//   rays     optional: true adds a slowly turning sunburst behind the art
window.CARDS = [
  {
    name: 'charizard',
    color: '#d8322b',
    icon: '🔥',
    art: 'cards/crystal-charizard.jpg',
    rounded: true,
    caption: 'crystal type · skyridge 146/144',
    pop: { src: 'cards/crystal-charizard-pop.png', box: [1, 4.4, 93.7, 68.3], cut: 48.5, float: true },
  },
];
