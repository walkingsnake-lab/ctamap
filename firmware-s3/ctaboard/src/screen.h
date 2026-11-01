// The screens this firmware draws, and the redraw key.
//
// Payloads name screens with strings (contract: `screen`, `rot.screens`);
// they're turned into a Screen once, at the JSON boundary, so the main loop
// compares small integers. A name this build doesn't know draws as transit,
// as Player::draw (and draw.js) would draw it.
//
// Platform independent: builds natively for tests.
#pragma once

#include <stdint.h>
#include <string.h>

#include <string>

namespace screen {

// In the order the buttons step through them and screens slide (a later
// one comes in from the right): the knob ring's order.
enum class Screen : uint8_t { Transit, Ticker, Weather, Baseball, Clock };
const int N_SCREENS = 5;

inline const char *name(Screen s) {
  static const char *const NAMES[N_SCREENS] = {"transit", "ticker", "weather", "baseball", "clock"};
  return NAMES[(int)s];
}

inline Screen from(const std::string &s) {
  for (int i = 0; i < N_SCREENS; i++)
    if (s == name((Screen)i)) return (Screen)i;
  return Screen::Transit;
}

inline Screen step(Screen s, int by) { return (Screen)((((int)s + by) % N_SCREENS + N_SCREENS) % N_SCREENS); }

// Everything a still frame depends on, as numbers: the board redraws only
// when this changes (none while an animation needs every frame).
struct FrameKey {
  long long v[6] = {};
  bool operator==(const FrameKey &o) const { return memcmp(v, o.v, sizeof v) == 0; }
  bool operator!=(const FrameKey &o) const { return !(*this == o); }
};

}  // namespace screen
