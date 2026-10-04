'use strict';
// Train Tracker route and destination names -> what the board shows.
// See docs/board/design-spec.md §5 "Destination labels".

// Train Tracker `rt` -> board line code (contract "Line codes").
const RT_TO_LN = { red: 'RD', blue: 'BL', brn: 'BR', g: 'GR', org: 'OR', p: 'PR', pink: 'PK', y: 'YL' };

// Display order for default row ordering.
const LINE_ORDER = ['RD', 'BL', 'BR', 'GR', 'OR', 'PR', 'PK', 'YL'];

// CTA `destNm` -> short name (mixed case; transit renders it uppercase).
const SHORT_DEST = {
  'Forest Park': 'Forest',
  '54th/Cermak': '54th',
  '95th/Dan Ryan': '95th',
  'Ashland/63rd': '63rd',
  'Harlem/Lake': 'Harlem',
  'Dempster-Skokie': 'Skokie',
  'UIC-Halsted': 'UIC',
  'Jefferson Park': 'Jeff Pk',
  'Cottage Grove': 'Cottage',
};

// Destinations CTA normally uses, shown as-is.
const PASS_THROUGH = new Set(['Howard', "O'Hare", 'Kimball', 'Loop', 'Linden', 'Midway', 'Rosemont', 'Cumberland']);

const lineCode = (rt) => RT_TO_LN[String(rt || '').toLowerCase()] || null;

// Returns { name, known }. Unknown destinations (reroutes, disruptions) keep
// CTA's name; callers fit it to width and log it so it can be added here.
function shortDest(destNm) {
  const d = String(destNm || '').trim();
  if (SHORT_DEST[d]) return { name: SHORT_DEST[d], known: true };
  return { name: d, known: PASS_THROUGH.has(d) };
}

module.exports = { RT_TO_LN, LINE_ORDER, SHORT_DEST, PASS_THROUGH, lineCode, shortDest };
