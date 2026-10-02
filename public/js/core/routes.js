/**
 * The site's pages and what search engines and link previews are told about
 * each: one table, read by navigation.js in the browser (title, description
 * and canonical follow the view) and by tools/build-static.mjs, which bakes
 * an HTML page per route. No browser APIs here — Node imports it too.
 *
 *   index: false   kept out of search results (a page that only makes sense
 *                  with a ?job=… of your own)
 *   crumbs         the pages above it, for the breadcrumb structured data
 */
export const SITE_NAME = 'Swaralaya';

export const ROUTES = [
  {
    path: '/', view: 'view-home', name: 'Home',
    title: 'Swaralaya — Indian Classical Music Practice Tools',
    description: 'Free practice tools for Indian classical music: lehra player with tanpura, Carnatic shruti box and talam, notation editor, swar tuner and ear-training games.',
  },
  {
    path: '/hindustani', view: 'view-hindustani', name: 'Hindustani',
    title: 'Hindustani Practice Suite: Lehra & Notation | Swaralaya',
    description: 'Tools for Hindustani riyaz: a lehra player on sarangi, harmonium, sitar and esraj at any tempo, a Bhatkhande notation editor, and practising along with songs.',
  },
  {
    path: '/lehra', view: 'view-lehra', name: 'Lehra Player', crumbs: ['/hindustani'],
    title: 'Online Lehra Player: Sarangi, Harmonium, Sitar, Esraj | Swaralaya',
    description: 'Play lehra for tabla and Kathak riyaz in Teentaal, Jhaptaal, Ektaal, Roopak and rarer taals. Change tempo and Sa live, add tanpura and metronome, export MP3.',
  },
  {
    path: '/notation', view: 'view-notation', name: 'Notation Editor', crumbs: ['/hindustani'],
    title: 'Bhatkhande Notation Editor for Tabla & Vocal | Swaralaya',
    description: 'Write tabla and vocal compositions in Bhatkhande or Paluskar notation, in English or Hindi. Play them back, export a PDF and share them by link, for free.',
  },
  {
    path: '/carnatic', view: 'view-carnatic', name: 'Carnatic',
    title: 'Carnatic Shruti Box & Talam Metronome | Swaralaya',
    description: 'A Carnatic practice suite: a tanpura or reed shruti box at any kattai, and a talam keeper for Adi, Rupaka, chapu and suladi talas with kalai and nadai.',
  },
  {
    path: '/games', view: 'view-games', name: 'Riyaz Games',
    title: 'Riyaz Games: Swar Ear Training & Sam Timing | Swaralaya',
    description: 'Two games for your ear and your laya: Swar Pehchaan, where you name the swar sung against a Sa drone, and Sam Pakdo, where you tap exactly on sam.',
  },
  {
    // Personal: a visitor's own numbers and their account
    path: '/account', view: 'view-account', name: 'Your Progress', index: false,
    title: 'Your Progress | Swaralaya',
    description: 'Your riyaz time and game scores, and an optional account to keep them across devices.',
  },
  {
    path: '/practice', view: 'view-practice', name: 'Practise Along', index: false,
    title: 'Practise Along | Swaralaya',
    description: 'Play the accompaniment of a separated song at your own Sa and tempo.',
  },
];

const byView = new Map(ROUTES.map(r => [r.view, r]));
const byPath = new Map(ROUTES.map(r => [r.path, r]));

export function routeForView(view) {
  return byView.get(view) || null;
}

export function routeForPath(path) {
  return byPath.get(path) || null;
}
