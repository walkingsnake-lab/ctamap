// UP/DOWN buttons vs. the phone (design spec §9): last action wins.
// A port of firmware/boardlib/control.py.
//
// A button press sets a local screen override and records the server's
// settings version. The override holds until the version changes (someone
// changed something on the phone), then the board follows the server again.
#pragma once

#include <optional>
#include <string>

namespace control {

static const char *const SCREENS[] = {"transit", "ticker", "weather", "baseball"};
static const int N_SCREENS = 4;

class ScreenOverride {
 public:
  std::optional<std::string> screen;
  std::string at_v;

  // step: +1 (DOWN) or -1 (UP). Returns the new screen. server_v: the
  // payload's `v`, as str().
  std::string press(int step, const std::string &current, const std::string &server_v) {
    int i = 0;
    for (int k = 0; k < N_SCREENS; k++)
      if (current == SCREENS[k]) i = k;
    screen = SCREENS[((i + step) % N_SCREENS + N_SCREENS) % N_SCREENS];
    at_v = server_v;
    return *screen;
  }

  std::string resolve(const std::string &server_screen, const std::string &server_v) {
    if (screen && server_v != at_v) screen.reset();  // a phone change wins
    return screen ? *screen : server_screen;
  }
};

// Edge detector for a button read once per loop.
class Debounce {
 public:
  explicit Debounce(double hold = 40) : hold_ms(hold) {}
  double hold_ms;

  // True once per press.
  bool update(bool down, double ms) {
    if (down && !pressed_) {
      if (!since_) since_ = ms;
      if (ms - *since_ >= hold_ms) {
        pressed_ = true;
        return true;
      }
    } else if (!down) {
      pressed_ = false;
      since_.reset();
    }
    return false;
  }

 private:
  bool pressed_ = false;
  std::optional<double> since_;
};

}  // namespace control
