// The color calibration screen (MATRIX_CALIBRATE 1 in secrets.h): the same
// pattern as the CircuitPython calibration script, for choosing a curve
// (color.h) on the panel itself.
//   y 0-3    grey ramp, 16 even steps
//   y 6-11   UI colors: amber 100/40/20%, schedule greys, label greys
//   y 14-21  line colors: RD BL BR GR OR PR PK YL
//   y 24-29  brown candidates (CTA first), purple candidates (CTA first)
//   y 31     white dots: the curve (1-4); blue dots: the mode (none: day;
//            1: night by scaling colors to 40%; 2: night dimmed in hardware)
// Platform independent.
#pragma once

#include "draw.h"

namespace calibrate {

enum Mode { DAY = 0, NIGHT_SCALED = 1, NIGHT_HARDWARE = 2 };
const int N_MODES = 3;
const char *mode_name(int mode);

// The colors at full brightness, or scaled to 40% for NIGHT_SCALED (the
// hardware mode dims on the panel instead).
void draw_pattern(draw::Frame &f, int curve, int mode);

}  // namespace calibrate
