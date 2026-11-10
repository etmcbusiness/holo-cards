// Built-in cards. Add one entry per card and drop its images in cards/.
// (Cards can also be added from the page with "+ Add card"; those stay on that device.)
//
//   name     the card's name, shown under the card
//   info     { game, set, year, number, edition }, shown under the name
//   art      the card scan (any size)
//   holo     [left, top, width, height] in % of the card: the art window, where the
//            hologram glitter goes
//   glitter  the glitter's colours as hues in degrees, picked from the card's art;
//            false for a non-holo card (no glitter, sparkles or foil)
//   style    'holo' (sparkles in the art window), 'reverse' (everywhere but the art
//            window) or 'none'
//            (the ✨ Holo button changes it per device)
//   ambience the background animation in the art window: embers, bubbles, leaves, petals,
//            sparks, snow, mist, stars or dust (guessed from the glitter colours if left out)
//   pop      the character cut out on a transparent PNG, bent into a gentle curve just
//            in front of the card. Its bottom should already fade out where it meets the
//            bottom of the art window.
//              box  [left, top, width, height] in % of the card; may go below 0 or past
//                   100 to stick out past the edge
window.CARDS = [
  {
    name: 'Charizard',
    info: { game: 'Pokémon', set: 'Skyridge', year: '2003', number: '146/144', edition: 'Crystal' },
    art: 'cards/crystal-charizard.jpg',
    holo: [10, 11.8, 86, 36.6],
    glitter: [45, 225, 195, 15],
    style: 'holo',
    ambience: 'embers',
    pop: { src: 'cards/crystal-charizard-pop.png', box: [1, 4.4, 93.7, 68.3] },
  },
  {
    name: 'Charizard',
    info: { game: 'Pokémon', set: 'Base Set', year: '1999', number: '4/102', edition: 'Unlimited' },
    art: 'cards/base-charizard.jpg',
    holo: [11.3, 11.1, 79, 40.7],
    glitter: [45, 15],
    style: 'holo',
    ambience: 'embers',
    pop: { src: 'cards/base-charizard-pop.png', box: [7.4, 12.1, 85.1, 42.3] },
  },
  {
    name: 'Charizard ★ δ',
    info: { game: 'Pokémon', set: 'Dragon Frontiers', year: '2006', number: '100/101', edition: '' },
    art: 'cards/star-charizard.jpg',
    holo: [7.3, 9.4, 86, 36.7],
    glitter: [155, 35, 5, 215],
    style: 'holo',
    ambience: 'embers',
    pop: { src: 'cards/star-charizard-pop.png', box: [0.8, 8.2, 98.1, 42.9] },
  },
];
