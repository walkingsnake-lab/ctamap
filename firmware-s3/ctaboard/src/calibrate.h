// The color calibration screen (MATRIX_CALIBRATE 1 in secrets.h): the same
// pattern as the CircuitPython calibration script, for choosing a curve
// (color.h) on the panel itself.
//   y 0-3    grey ramp, 16 even steps
//   y 6-11   UI colors: amber 100/40/20%, schedule greys, label greys
//   y 14-21  line colors: RD BL BR GR OR PR PK YL
//   y 24-29  brown candidates (CTA first), purple candidates (CTA first)
//   y 31     white dots: the curve (1-4); blue dot: night (40%)
// Platform independent.
#pragma once

#include "draw.h"

namespace calibrate {

void draw_pattern(draw::Frame &f, int curve, bool night);

}  // namespace calibrate
