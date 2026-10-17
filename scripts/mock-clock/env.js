'use strict';
// Data the faces read from env besides fonts and icons.

const stations = require('../../server/board/stations.json');

// Red Line stations north to south (Howard to 95th), board short names.
function redLine() {
  return stations.filter((s) => s.lines.includes('RD')).sort((a, b) => b.lat - a.lat).map((s) => s.short);
}

module.exports = { redLine };
