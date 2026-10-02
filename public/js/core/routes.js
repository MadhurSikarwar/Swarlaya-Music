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
    title: 'Swaralaya — Free Indian Classical Music Practice Tools Online',
    description: 'Free online tools for Indian classical music riyaz: tabla practice lehra, tanpura, Carnatic shruti box, Bhatkhande notation, swar ear training and laya games.',
  },
  {
    path: '/hindustani', view: 'view-hindustani', name: 'Hindustani',
    title: 'Hindustani Riyaz: Tabla Lehra, Notation & Tanpura | Swaralaya',
    description: 'Hindustani riyaz tools: online lehra for tabla and Kathak practice on sarangi, harmonium, sitar and esraj; Bhatkhande and Paluskar notation editor; tanpura.',
  },
  {
    path: '/lehra', view: 'view-lehra', name: 'Lehra Player', crumbs: ['/hindustani'],
    title: 'Online Lehra Player for Tabla & Kathak Practice | Swaralaya',
    description: 'Free lehra player for tabla riyaz: Teentaal, Jhaptaal, Ektaal, Roopak and more, on sarangi, harmonium, sitar or esraj. Change tempo and Sa live, export MP3.',
  },
  {
    path: '/notation', view: 'view-notation', name: 'Notation Editor', crumbs: ['/hindustani'],
    title: 'Bhatkhande & Paluskar Notation Editor — Tabla | Swaralaya',
    description: 'Write tabla and vocal compositions in Bhatkhande or Paluskar notation, in English or Hindi. Play them back, export as PDF and share by link. Free online.',
  },
  {
    path: '/carnatic', view: 'view-carnatic', name: 'Carnatic',
    title: 'Online Carnatic Shruti Box, Tanpura & Talam Keeper | Swaralaya',
    description: 'Free Carnatic practice tools: shruti box and tanpura at any kattai, plus talam keeper for Adi, Rupaka, Misra Chapu, Khanda Chapu and all 35 suladi talas with kalai and nadai.',
  },
  {
    path: '/games', view: 'view-games', name: 'Riyaz Games',
    title: 'Indian Classical Music Ear Training & Laya Games | Swaralaya',
    description: 'Two free games for riyaz: Swar Pehchaan (identify swars by ear against a Sa drone) and Sam Pakdo (tap exactly on sam). Build swar recognition and tabla timing skills.',
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
