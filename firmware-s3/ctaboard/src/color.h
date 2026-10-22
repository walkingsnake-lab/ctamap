// The panel's color pipeline: what light each 8-bit channel value ends up as.
//
// The DMA driver runs every channel through its own CIE 1931 lightness curve
// (lumConvTab_8bit in its cie_luts.h; cie8() reproduces it exactly). That
// curve is gentler on dark values than the CircuitPython firmware's gamma
// 2.2 plus RGB565 truncation, so faint "tint" channels that CircuitPython
// dropped stay lit and dark colors wash out (CTA brown reads tan). To pick
// the look independently of the driver, Pipeline computes the light it wants
// per channel (a "level", 0-255 on the driver's output scale) and sends the
// driver input that produces it (the CIE curve inverted).
//
// Curves:
//   DRIVER     the driver's CIE curve alone
//   GAMMA22    gamma 2.2
//   CIRCUITPY  gamma 2.2, then RGB565 + 6-bit truncation, as on the
//              CircuitPython firmware at MATRIX_GAMMA 2.2 / bit depth 6
//   GAMMA26    gamma 2.6 (darker, more saturated)
// Every curve keeps the dim-color floor: a color that would go fully dark
// has its brightest channel lifted to the curve's floor (firmware/boardlib
// device.py correct()).
//
// Platform independent: tested natively (firmware-s3/tests/color_test.cpp).
#pragma once

#include <stdint.h>

namespace color {

enum Curve { DRIVER = 0, GAMMA22 = 1, CIRCUITPY = 2, GAMMA26 = 3 };
const int N_CURVES = 4;

const char *curve_name(int curve);

// The driver's 8-bit CIE table: input 0-255 -> output level 0-255.
int cie8(int v);

class Pipeline {
 public:
  explicit Pipeline(int curve = CIRCUITPY) { set_curve(curve); }
  void set_curve(int curve);
  int curve() const { return curve_; }

  // The light a color should be, as output levels (before the driver).
  void levels(uint8_t &r, uint8_t &g, uint8_t &b) const;
  // The driver inputs for a color: levels() mapped through the inverse
  // CIE curve, so the driver's own curve turns them back into those levels.
  void map(uint8_t &r, uint8_t &g, uint8_t &b) const;

 private:
  int curve_ = CIRCUITPY;
  uint8_t lv_[256];   // value -> level, before truncation
  uint8_t inv_[256];  // level -> smallest driver input that reaches it
  uint8_t floor_ = 1;
  uint8_t mask_[3] = {0xFF, 0xFF, 0xFF};  // per-channel truncation (CIRCUITPY)
};

}  // namespace color
