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
  '63rd Street': '63rd',  // what Train Tracker actually sends for Green Line trains to Ashland/63rd
  'Harlem/Lake': 'Harlem',
  'Dempster-Skokie': 'Skokie',
  'UIC-Halsted': 'UIC',
  'Jefferson Park': 'Jeff Pk',
  'Cottage Grove': 'Cottage',
};

// Destinations CTA normally uses, shown as-is.
const PASS_THROUGH = new Set(['Howard', "O'Hare", 'Kimball', 'Loop', 'Linden', 'Midway', 'Rosemont', 'Cumberland']);

// CTA `destNm` -> the station (mapid) the train ends at. Train Tracker's
// destination names don't always match station names ("63rd Street" for
// Ashland/63rd), so terminal arrivals are recognized through this map.
const DEST_MAPID = {
  'Howard': '40900',
  '95th/Dan Ryan': '40450',
  "O'Hare": '40890',
  'Forest Park': '40390',
  'UIC-Halsted': '40350',
  'Jefferson Park': '41280',
  'Rosemont': '40820',
  'Cumberland': '40230',
  'Kimball': '41290',
  'Midway': '40930',
  'Harlem/Lake': '40020',
  'Ashland/63rd': '40290',
  '63rd Street': '40290',
  'Cottage Grove': '40720',
  '54th/Cermak': '40580',
  'Linden': '41050',
  'Dempster-Skokie': '40140',
};

// Every destination each line's trains can show (Train Tracker `destNm`), in
// direction order (trDr 1 first). Used for the phone page's destination
// filter, so rush-only service (Purple to the Loop) can be chosen off-peak.
const LINE_DESTS = {
  RD: ['Howard', '95th/Dan Ryan'],
  BL: ["O'Hare", 'Rosemont', 'Jefferson Park', 'Cumberland', 'Forest Park', 'UIC-Halsted'],
  BR: ['Kimball', 'Loop'],
  GR: ['Harlem/Lake', '63rd Street', 'Cottage Grove'],
  OR: ['Loop', 'Midway'],
  PR: ['Linden', 'Howard', 'Loop'],
  PK: ['Loop', '54th/Cermak'],
  YL: ['Dempster-Skokie', 'Howard'],
};

const lineCode = (rt) => RT_TO_LN[String(rt || '').toLowerCase()] || null;

// True when a prediction is for a train that ends at this station.
function endsHere(e) {
  const dest = String(e.destNm || '').trim();
  if (dest === String(e.staNm || '').trim()) return true;
  if (DEST_MAPID[dest] && DEST_MAPID[dest] === String(e.staId)) return true;
  return /terminal arrival/i.test(String(e.stpDe || ''));
}

// Returns { name, known }. Unknown destinations (reroutes, disruptions) keep
// CTA's name; callers fit it to width and log it so it can be added here.
function shortDest(destNm) {
  const d = String(destNm || '').trim();
  if (SHORT_DEST[d]) return { name: SHORT_DEST[d], known: true };
  return { name: d, known: PASS_THROUGH.has(d) };
}

// Purple trains only run to Howard from Evanston (north of Howard).
const HOWARD_LAT = 42.019063;

// Destination row keys ("RD:Howard") a station can have, in default row
// order, without trains that end at the station. st: a stations.json entry.
function stationDestinations(st) {
  const out = [];
  for (const ln of LINE_ORDER) {
    if (!st.lines.includes(ln)) continue;
    for (const d of LINE_DESTS[ln]) {
      if (DEST_MAPID[d] === st.mapid) continue;
      if (ln === 'PR' && d === 'Howard' && !(st.lat > HOWARD_LAT)) continue;
      const key = `${ln}:${shortDest(d).name}`;
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

module.exports = { RT_TO_LN, LINE_ORDER, SHORT_DEST, PASS_THROUGH, DEST_MAPID, LINE_DESTS, lineCode, shortDest, endsHere, stationDestinations };
