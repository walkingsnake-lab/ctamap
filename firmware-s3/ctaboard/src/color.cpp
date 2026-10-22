#include "color.h"

#include <math.h>

namespace color {

const char *curve_name(int curve) {
  switch (curve) {
    case DRIVER: return "driver CIE";
    case GAMMA22: return "gamma 2.2";
    case CIRCUITPY: return "CircuitPython look (gamma 2.2, 565 / 6-bit)";
    case GAMMA26: return "gamma 2.6";
  }
  return "?";
}

int cie8(int v) {
  // The driver's tools/generate_cie_luts.py: L = v / 255 * 100, then
  // Y = L / 902.3 for L <= 8, else ((L + 16) / 116)^3; output round(Y * 255).
  double L = v / 255.0 * 100;
  double Y = L <= 8 ? L / 902.3 : pow((L + 16) / 116, 3);
  return (int)floor(Y * 255 + 0.5);
}

void Pipeline::set_curve(int curve) {
  curve_ = curve >= 0 && curve < N_CURVES ? curve : CIRCUITPY;
  for (int v = 0; v < 256; v++) {
    double x = v / 255.0;
    int level;
    switch (curve_) {
      case DRIVER: level = cie8(v); break;
      case GAMMA26: level = (int)floor(pow(x, 2.6) * 255 + 0.5); break;
      default: level = (int)floor(pow(x, 2.2) * 255 + 0.5); break;  // GAMMA22, CIRCUITPY (device.py gamma_lut)
    }
    lv_[v] = (uint8_t)level;
  }
  // Inverse: the smallest input the driver turns into at least that level.
  int i = 0;
  for (int k = 0; k < 256; k++) {
    while (i < 255 && cie8(i) < k) i++;
    inv_[k] = (uint8_t)i;
  }
  inv_[0] = 0;
  if (curve_ == CIRCUITPY) {
    // RGB565 into a 6-bit panel: red and blue keep 5 bits, green 6. The floor
    // is the smallest value that survives (device.py: 256 >> min(depth, 5)).
    floor_ = 8;
    mask_[0] = 0xF8;
    mask_[1] = 0xFC;
    mask_[2] = 0xF8;
  } else {
    floor_ = 1;
    mask_[0] = mask_[1] = mask_[2] = 0xFF;
  }
}

void Pipeline::levels(uint8_t &r, uint8_t &g, uint8_t &b) const {
  if (!(r | g | b)) return;
  uint8_t lr = lv_[r], lg = lv_[g], lb = lv_[b];
  uint8_t m = lr > lg ? (lr > lb ? lr : lb) : (lg > lb ? lg : lb);
  if (m < floor_) {
    // Would go fully dark: lift the brightest channel to the floor and drop
    // the rest, so dim elements never vanish or pick up a tint.
    uint8_t top = r > g ? (r > b ? r : b) : (g > b ? g : b);
    lr = r == top ? floor_ : 0;
    lg = g == top ? floor_ : 0;
    lb = b == top ? floor_ : 0;
  }
  r = lr & mask_[0];
  g = lg & mask_[1];
  b = lb & mask_[2];
}

void Pipeline::map(uint8_t &r, uint8_t &g, uint8_t &b) const {
  levels(r, g, b);
  r = inv_[r];
  g = inv_[g];
  b = inv_[b];
}

}  // namespace color
