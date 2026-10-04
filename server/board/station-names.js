'use strict';
// Curated short names for the transit header, keyed by the City of Chicago
// dataset's `station_name`. Only stations whose full uppercase name doesn't
// fit HEADER_NAME_PX need an entry; scripts/build-stations.js fails on any
// station that overflows without one. The phone page can still override the
// header name per board.

// Header: name at x=1, clock right-aligned at column 62. Widest clock
// ("12:59") is 17px, plus a 3px gap -> 42px for the name.
const HEADER_NAME_PX = 42;

const SHORT_NAMES = {
  'North/Clybourn': 'NORTH/CLYB',
  'Clark/Division': 'CLARK/DIV',
  'Cermak-Chinatown': 'CHINATOWN',
  '95th/Dan Ryan': '95TH',
  '54th/Cermak': '54TH/CERMK',
  '35th/Archer': '35TH/ARCHR',
  'Harlem/Lake': 'HARLEM/LK',
  'Central Park': 'CENTRAL PK',
  'Conservatory': 'CONSERVTRY',
  'Cermak-McCormick Place': 'MCCORMICK',
  '35th-Bronzeville-IIT': '35TH-IIT',
  'Cottage Grove': 'COTTAGE GR',
  'Ashland/63rd': 'ASHLAND/63',
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

module.exports = { HEADER_NAME_PX, SHORT_NAMES };
