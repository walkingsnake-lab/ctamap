// UP/DOWN buttons vs. the phone (design spec §9): last action wins.
// A port of firmware/boardlib/control.py. Also the knob's chooser (S3 only,
// design spec §10, "Knob"): twist and rest.
//
// A button press sets a local screen override and records the server's
// settings version. The override holds until the version changes (someone
// changed something on the phone), then the board follows the server again.
#pragma once

#include <math.h>

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

// The knob chooser: turning opens it on the screen the board is on (the
// payload's knob.at) and steps through the ring, one entry per click, with
// a short slide. CHOOSER_REST_MS after the last click it's done: back on the
// starting entry it just closes (cancel); otherwise the board commits the
// selection (/board/select). Positions are ring indexes, unwrapped (the
// renderer wraps them), so the slide never jumps across the wrap.
const double CHOOSER_SLIDE_MS = 180;
const double CHOOSER_REST_MS = 1000;

class Chooser {
 public:
  bool open = false;
  bool committing = false;  // the selection is being sent; drawn in amber
  int n = 0;                // ring length when it opened
  int start = 0;            // ring index of the screen the board was on
  long long target = 0;     // unwrapped ring index the wheel is heading to
  double from = 0, t0 = 0, last = 0;

  // clicks: + clockwise (the wheel moves right through the ring), - back.
  void turn(int clicks, int at, int ring_n, double ms) {
    if (!clicks || ring_n <= 0) return;
    if (!open || committing) {
      open = true;
      committing = false;
      n = ring_n;
      start = ((at % ring_n) + ring_n) % ring_n;
      target = start;
      from = start;
      t0 = ms - CHOOSER_SLIDE_MS;
    }
    from = pos(ms);
    target += clicks;
    t0 = ms;
    last = ms;
  }

  // Wheel position at ms: eases out from where it was toward the target.
  double pos(double ms) const {
    double k = (ms - t0) / CHOOSER_SLIDE_MS;
    if (k >= 1) return (double)target;
    if (k < 0) k = 0;
    double e = 1 - (1 - k) * (1 - k) * (1 - k);
    return from + ((double)target - from) * e;
  }
  bool sliding(double ms) const { return open && ms - t0 < CHOOSER_SLIDE_MS; }
  int selected() const { return n > 0 ? (int)(((target % n) + n) % n) : 0; }
  bool rested(double ms) const { return open && !committing && ms - last >= CHOOSER_REST_MS; }
  bool cancelled() const { return selected() == start; }
  void close() {
    open = false;
    committing = false;
  }
  // Redraw key: none while sliding (every frame), else the still frame's state.
  std::optional<std::string> frame_key(double ms) const {
    if (sliding(ms)) return std::nullopt;
    return "chooser|" + std::to_string(target) + "|" + (committing ? "1" : "0");
  }
};

}  // namespace control
