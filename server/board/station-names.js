'use strict';
// Header short names for stations, keyed by the City of Chicago dataset's
// `station_name`. Shortening order (see shortName):
//   1. the full uppercase name, if it fits HEADER_NAME_PX;
//   2. the name with ordinal suffixes dropped ("95th/Dan Ryan" -> "95/DAN RYAN");
//   3. a curated entry in SHORT_NAMES.
// scripts/build-stations.js fails on any station that still overflows. The
// phone page can still override the header name per board.

// Header: name at x=1, clock right-aligned at column 62. Widest clock
// ("12:59") is 17px, plus a 3px gap -> 42px for the name.
const HEADER_NAME_PX = 42;

const SHORT_NAMES = {
  'North/Clybourn': 'NORTH/CLYB',
  'Clark/Division': 'CLARK/DIV',
  'Cermak-Chinatown': 'CHINATOWN',
  'Harlem/Lake': 'HARLEM/LK',
  'Central Park': 'CENTRAL PK',
  'Conservatory': 'CONSERVTRY',
  'Cermak-McCormick Place': 'MCCORMICK',
  '35th-Bronzeville-IIT': '35-IIT',
  'Cottage Grove': 'COTTAGE GR',
  'Jefferson Park': 'JEFF PARK',
  'Logan Square': 'LOGAN SQ',
  'UIC-Halsted': 'UIC',
  'Illinois Medical District': 'MED DISTRCT',
  'Kedzie-Homan': 'KEDZIE',
  'Washington/Wabash': 'WASH/WAB',
  'Adams/Wabash': 'ADAMS/WAB',
  'Harold Washington Library-State/Van Buren': 'HW LIBRARY',
  'LaSalle/Van Buren': 'LASALLE/VB',
  'Washington/Wells': 'WASH/WELL',
  'South Boulevard': 'SOUTH BLVD',
  'Oakton-Skokie': 'OAKTON',
  'Dempster-Skokie': 'SKOKIE',
  'Merchandise Mart': 'MERCH MART',
};

const dropOrdinals = (name) => name.replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1');

// Returns the header name for a station, or null if nothing fits.
// `measure` is fonts.measure, passed in to keep this module data-only.
function shortName(name, measure) {
  const fits = (s) => measure('small', s) <= HEADER_NAME_PX;
  const full = name.toUpperCase();
  if (fits(full)) return full;
  const noOrd = dropOrdinals(full);
  if (fits(noOrd)) return noOrd;
  const curated = SHORT_NAMES[name];
  return curated && fits(curated) ? curated : null;
}

module.exports = { HEADER_NAME_PX, SHORT_NAMES, dropOrdinals, shortName };
