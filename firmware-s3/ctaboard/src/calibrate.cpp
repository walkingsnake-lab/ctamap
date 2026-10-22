#include "calibrate.h"

namespace calibrate {

static const uint32_t UI[] = {0xffb000, 0x664600, 0x332300, 0x6a6a6a, 0x2e2e2e,
                              0x151515, 0xd8d8d8, 0x8f8f8f, 0x555555, 0x333333};
static const uint32_t LINES[] = {0xc60c30, 0x00a1de, 0x62361b, 0x009b3a, 0xf9461c, 0x522398, 0xe27ea6, 0xf9e300};
static const uint32_t CANDIDATES[] = {0x62361b, 0x7a4a1c, 0x8a5a24, 0x96602a, 0x522398, 0x6a2fc0, 0x7038d8, 0x8040e0};

void draw_pattern(draw::Frame &f, int curve, bool night) {
  // Night: the renderer's brightness scaling at 40%, before the curve.
  auto c = [&](uint32_t v) { return night ? draw::scale_color(draw::hexc(v), 0.4) : draw::hexc(v); };
  for (int i = 0; i < 16; i++) {
    uint32_t v = (uint32_t)((i * 255 + 7) / 15);
    f.fill(i * 4, 0, 4, 4, c(v << 16 | v << 8 | v));
  }
  for (int i = 0; i < 10; i++) f.fill(2 + i * 6, 6, 6, 6, c(UI[i]));
  for (int i = 0; i < 8; i++) f.fill(i * 8, 14, 8, 8, c(LINES[i]));
  for (int i = 0; i < 8; i++) f.fill(i * 8, 24, 8, 6, c(CANDIDATES[i]));
  for (int i = 0; i <= curve; i++) f.fill(i * 2, 31, 1, 1, draw::hexc(0x606060));
  if (night) f.fill(32, 31, 1, 1, draw::hexc(0x000060));
}

}  // namespace calibrate
