// The panel color pipeline (src/color.cpp): the driver's CIE table, its
// inverse, and the curves. Expected values for the CircuitPython look come
// from firmware/boardlib/device.py (gamma_lut + correct) plus RGB565 6-bit
// truncation, computed independently in Python.
//   color_test   (exit status 0 when every check passes)

#include <math.h>
#include <stdio.h>

#include "../ctaboard/src/color.h"

static int failed = 0, checks = 0;
#define CHECK(cond, ...)                                    \
  do {                                                      \
    checks++;                                               \
    if (!(cond)) {                                          \
      failed++;                                             \
      printf("FAIL line %d: %s ", __LINE__, #cond);         \
      printf(" " __VA_ARGS__);                              \
      printf("\n");                                         \
    }                                                       \
  } while (0)

struct Case {
  uint8_t r, g, b, lr, lg, lb;
};

int main() {
  // The driver's lumConvTab_8bit (cie_luts.h), spot checks: 0-4 dark, 5 the
  // first visible step, 14 the second, full scale at 255; and monotonic.
  CHECK(color::cie8(4) == 0 && color::cie8(5) == 1 && color::cie8(13) == 1 && color::cie8(14) == 2, "");
  CHECK(color::cie8(255) == 255, "%d", color::cie8(255));
  for (int v = 1; v < 256; v++) CHECK(color::cie8(v) >= color::cie8(v - 1), "%d", v);

  // CircuitPython look: device.py gamma 2.2 + floor, then 565 truncation.
  const Case cp[] = {
      {0x62, 0x36, 0x1b, 24, 8, 0},    // CTA brown: reddish brown, the faint blue gone
      {0xf9, 0x46, 0x1c, 240, 12, 0},  // CTA orange
      {0xc6, 0x0c, 0x30, 144, 0, 0},   // CTA red
      {0x15, 0x15, 0x15, 8, 8, 8},     // dimmest grey: lifted to the floor
      {0x33, 0x23, 0x00, 8, 0, 0},     // 20% amber: floor on its brightest channel
      {0x52, 0x23, 0x98, 16, 0, 80},   // CTA purple
  };
  color::Pipeline pl(color::CIRCUITPY);
  for (const Case &c : cp) {
    uint8_t r = c.r, g = c.g, b = c.b;
    pl.levels(r, g, b);
    CHECK(r == c.lr && g == c.lg && b == c.lb, "#%02x%02x%02x -> (%d, %d, %d)", c.r, c.g, c.b, r, g, b);
  }

  // For every curve, the driver input sent turns into exactly the wanted
  // level (or the nearest one the driver can make above it).
  for (int curve = 0; curve < color::N_CURVES; curve++) {
    color::Pipeline p(curve);
    int bad = 0;
    for (int v = 0; v < 256; v++) {
      uint8_t lr = (uint8_t)v, lg = 0, lb = 0, ir = (uint8_t)v, ig = 0, ib = 0;
      p.levels(lr, lg, lb);
      p.map(ir, ig, ib);
      int out = color::cie8(ir);
      bool exact_or_next = out >= lr && (ir == 0 || color::cie8(ir - 1) < lr);
      if (!exact_or_next) bad++;
    }
    CHECK(bad == 0, "%s: %d values off", color::curve_name(curve), bad);
  }

  // The driver curve alone sends the color through unchanged (same light).
  color::Pipeline drv(color::DRIVER);
  for (int v = 5; v < 256; v++) {
    uint8_t r = (uint8_t)v, g = 0, b = 0;
    drv.map(r, g, b);
    CHECK(color::cie8(r) == color::cie8(v), "%d", v);
  }
  // A frame without the floor (the skyline): colors too dark for the panel go
  // black instead of being lifted to one primary; brighter ones are unchanged.
  {
    struct Dark { uint8_t r, g, b; };
    const Dark night[] = {{0x0c, 0x14, 0x30}, {0x1a, 0x16, 0x1b}, {0x2a, 0x26, 0x30}, {0x03, 0x08, 0x16}};
    color::Pipeline p(color::CIRCUITPY);
    for (const Dark &d : night) {
      uint8_t r = d.r, g = d.g, b = d.b, fr = d.r, fg = d.g, fb = d.b;
      p.levels(r, g, b, false);
      p.levels(fr, fg, fb);
      CHECK(r == 0 && g == 0 && b == 0, "no floor: #%02x%02x%02x -> (%d, %d, %d)", d.r, d.g, d.b, r, g, b);
      CHECK(fr + fg + fb > 0, "with the floor it's lifted: #%02x%02x%02x", d.r, d.g, d.b);
    }
    // Just above the bottom step a dim near-grey stays grey (every channel at
    // the step) instead of keeping only its strongest one; a dim red stays red.
    uint8_t r = 0x34, g = 0x2d, b = 0x32;
    p.levels(r, g, b, false);
    CHECK(r == 8 && g == 8 && b == 8, "dim grey stays grey: (%d, %d, %d)", r, g, b);
    r = 0x40; g = 0x10; b = 0x10;
    p.levels(r, g, b, false);
    CHECK(r == 8 && g == 0 && b == 0, "dark red beacon stays red: (%d, %d, %d)", r, g, b);
    for (int v = 80; v < 256; v += 7) {
      uint8_t a = (uint8_t)v, b2 = (uint8_t)(v * 3 / 4), c = 0, a2 = a, bb = b2, c2 = 0;  // every lit channel clearly above the bottom step
      p.levels(a, b2, c, false);
      p.levels(a2, bb, c2);
      CHECK(a == a2 && b2 == bb && c == c2, "bright colors don't care: %d", v);
    }
  }

  // Black stays black on every curve.
  for (int curve = 0; curve < color::N_CURVES; curve++) {
    color::Pipeline p(curve);
    uint8_t r = 0, g = 0, b = 0;
    p.map(r, g, b);
    CHECK(r == 0 && g == 0 && b == 0, "%d", curve);
  }

  // Hardware dimming: the window down to its floor, then the renderer's share.
  color::HwDim d = color::hw_dim(1);
  CHECK(d.oe == 255 && d.share == 1, "%d %f", d.oe, d.share);
  d = color::hw_dim(0.4);  // the default night level: all in hardware
  CHECK(d.oe == 34 && d.share == 1, "%d %f", d.oe, d.share);
  d = color::hw_dim(0.1);
  CHECK(d.oe == color::HW_MIN_OE && fabs(d.share - 0.1 / pow(16 / 255.0, 1 / 2.2)) < 1e-9, "%d %f", d.oe, d.share);
  d = color::hw_dim(0);
  CHECK(d.oe == 0 && d.share == 1, "off: %d %f", d.oe, d.share);
  // Continuous across the floor: the light (window x share^2.2) only grows with k.
  double prev = 0;
  for (int i = 1; i <= 1000; i++) {
    color::HwDim e = color::hw_dim(i / 1000.0);
    double light = e.oe / 255.0 * pow(e.share, 2.2);
    CHECK(light >= prev - 1e-9, "k %d: %f < %f", i, light, prev);
    CHECK(e.oe >= color::HW_MIN_OE, "k %d: oe %d", i, e.oe);
    prev = light;
  }

  printf("color: %d checks, %d failed\n", checks, failed);
  return failed ? 1 : 0;
}
