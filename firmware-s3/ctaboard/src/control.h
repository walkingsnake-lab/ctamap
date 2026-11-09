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
#include <vector>

#include "screen.h"

namespace control {

using screen::Screen;

// The buttons step through every screen (screen.h; this firmware draws the
// clock screen, so it's in the cycle: the server only resolves `clock` for
// boards that report the `skyline` capability, which this build does).
class ScreenOverride {
 public:
  std::optional<Screen> screen;
  double at_v = 0;

  // step: +1 (DOWN) or -1 (UP). Returns the new screen. server_v: the
  // payload's settings version `v`.
  Screen press(int step, Screen current, double server_v) {
    screen = screen::step(current, step);
    at_v = server_v;
    return *screen;
  }

  Screen resolve(Screen server_screen, double server_v) {
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
  std::optional<screen::FrameKey> frame_key(double ms) const {
    if (sliding(ms)) return std::nullopt;
    screen::FrameKey k;
    k.v[0] = -1;  // not a Screen
    k.v[1] = target;
    k.v[2] = committing;
    return k;
  }
};

// The peek chooser (spec §10, "Knob"; boards whose payload carries
// knob.vars): the icon bar over the screen on the panel, dimmed. Turning
// steps through the ring (k); a press steps the category's variant; holding
// the knob down while turning steps the variants either way. Each step
// glides the bar's selection there from wherever it is. PEEK_REST_MS after
// the last click or release it's done: back on the starting view the bar
// drops and the dim lifts (closing); otherwise the chosen view fades in
// (chose) and the board commits the choice (/board/select with its variant).
// Each category keeps its variant (sel) while the chooser is open. Times are
// ms on the loop's clock; the Board turns them into the glide and the bar's
// drop (draw::peek_drop).
const double PEEK_REST_MS = 1000;
// The bar's glide timing and curve (draw.js PEEK.xMs, yMs; ease-out cubic):
// only where a glide starts follows it, the pixels come from draw::.
const double PEEK_GLIDE_X_MS = 270, PEEK_GLIDE_Y_MS = 300;

class PeekChooser {
 public:
  bool open = false;
  bool closing = false;     // the bar is dropping away (commit or cancel)
  bool chose = false;       // closing on a new choice (its view fades in)
  bool committing = false;  // the choice is being sent (until it lands)
  bool sent = false;        // ... and its request has gone out
  bool holding = false;     // the knob is held down
  bool hold_turned = false;  // ... and turned while held (no tap on release)
  int n = 0, k = 0, start_k = 0, start_vi = 0;
  std::vector<int> nv, sel;  // per ring entry: variant count, and the one shown
  double opened = 0, last = 0, closed_at = 0;
  // The bar's glide: from (glide_k, glide_vi), fractional, vertical for a
  // variant; started at glide_t0.
  bool glide = false, glide_y = false;
  double glide_k = 0, glide_vi = 0, glide_t0 = 0;

  int vi() const { return k < (int)sel.size() ? sel[k] : 0; }

  // counts, sels: knob.vars sizes and knob.sel; at: knob.at.
  void start(const std::vector<int> &counts, const std::vector<int> &sels, int at, double ms) {
    n = (int)counts.size();
    nv = counts;
    sel.assign(n, 0);
    for (int i = 0; i < n && i < (int)sels.size(); i++) sel[i] = sels[i] >= 0 && sels[i] < counts[i] ? sels[i] : 0;
    k = start_k = n ? ((at % n) + n) % n : 0;
    start_vi = vi();
    open = true;
    closing = chose = committing = sent = holding = hold_turned = glide = false;
    opened = last = ms;
  }
  // A payload landed while open: its knob.vars sizes. A different ring
  // cancels the choice (the bar drops); otherwise each count follows the
  // payload and a variant past the end goes back to the first.
  void resync(const std::vector<int> &counts, double ms) {
    if (!open || closing) return;
    if ((int)counts.size() != n) {
      close(ms, false);
      return;
    }
    nv = counts;
    for (int i = 0; i < n; i++)
      if (sel[i] >= nv[i]) sel[i] = 0;
    if (start_vi >= nv[start_k]) start_vi = 0;
  }
  // clicks: + clockwise. While held, they step the variant.
  void turn(int clicks, double ms) {
    if (!open || closing || !clicks || n <= 0) return;
    if (holding) {
      hold_turned = true;
      int m = nv[k];
      if (m < 2) return;
      begin_glide(true, ms);
      sel[k] = (((sel[k] + clicks) % m) + m) % m;
    } else {
      begin_glide(false, ms);
      k = (((k + clicks) % n) + n) % n;
    }
    last = ms;
  }
  void press(double ms) {
    if (!open || closing) return;
    holding = true;
    hold_turned = false;
    last = ms;
  }
  // Released: a press without a turn steps to the next variant.
  void release(double ms) {
    if (!holding) return;
    holding = false;
    if (!hold_turned && open && !closing && nv[k] > 1) {
      begin_glide(true, ms);
      sel[k] = (sel[k] + 1) % nv[k];
    }
    last = ms;
  }
  bool rested(double ms) const { return open && !closing && !holding && ms - last >= PEEK_REST_MS; }
  bool cancelled() const { return k == start_k && vi() == start_vi; }
  void close(double ms, bool commit) {
    closing = true;
    chose = commit;
    committing = commit;
    sent = false;
    holding = false;
    closed_at = ms;
  }

 private:
  // Where the bar is now: mid-glide, part way from its start to (k, vi).
  void begin_glide(bool y, double ms) {
    double gk = k, gv = vi();
    if (glide) {
      double t = ms - glide_t0, d = glide_y ? PEEK_GLIDE_Y_MS : PEEK_GLIDE_X_MS;
      double c = t / d < 0 ? 0 : t / d > 1 ? 1 : t / d, e = 1 - (1 - c) * (1 - c) * (1 - c);
      if (e < 1 && glide_y == y) {
        if (y) gv = glide_vi + (gv - glide_vi) * e;
        else gk = glide_k + (gk - glide_k) * e;
      }
    }
    glide = true;
    glide_y = y;
    glide_k = gk;
    glide_vi = gv;
    glide_t0 = ms;
  }
};

}  // namespace control
