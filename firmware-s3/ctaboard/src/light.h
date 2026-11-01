// Auto brightness from the light sensor (Adafruit VEML7700 on the knob's
// STEMMA QT chain; device::LightSensor). Plain C++ so the tests build
// natively; the Board feeds it readings and asks for a level.
//
// The level follows the room, from the payload's `ab.min` in the dark to 100,
// linear in log lux. It only moves once every reading for HOLD_MS has been
// STEP points or more away (a passing shadow doesn't dim the panel), then
// fades to the latest reading's level over FADE_MS. The smoothed reading is
// only for the Health report.
#pragma once

#include <algorithm>
#include <cmath>
#include <optional>

namespace light {

// Lux at the chip. Under the case's 2 mm hole it sees a ~±10° patch of
// ceiling, a few percent of the room's light. Starting points: tune them
// from the Light sensor reading on the control page's Health tab.
const double DARK_LUX = 0.1;   // at or below: the darkest level (ab.min)
const double BRIGHT_LUX = 10;  // at or above: full brightness
const long long READ_EVERY = 1000;  // ms between readings
const double SMOOTH_MS = 5000;      // time constant of the reported lux (in log lux)
const double STEP = 5;              // percent: a smaller change never moves the level
const long long HOLD_MS = 5000;     // a change must last this long to move the level
const long long FADE_MS = 2000;     // fade to a new level
const long long STALE_MS = 10000;   // no reading this long: the sensor is gone

// Percent for `lux`, from `min` (DARK_LUX and below) to 100 (BRIGHT_LUX and
// above), linear in log lux, rounded to whole percent.
inline double level(double lux, double min) {
  double lo = std::log10(DARK_LUX), hi = std::log10(BRIGHT_LUX);
  double x = std::log10(std::max(lux, 1e-4));
  double f = std::max(0.0, std::min(1.0, (x - lo) / (hi - lo)));
  return std::floor(min + (100 - min) * f + 0.5);
}

// The sensor's smoothed reading and the level it holds.
class Sense {
 public:
  void reading(double lux, long long ms) {
    double l = std::log10(std::max(lux, 1e-4));
    if (!read_at_) ll_ = l;
    else ll_ += (l - ll_) * (1 - std::exp(-(double)(ms - *read_at_) / SMOOTH_MS));
    read_at_ = ms;
    raw_ = lux;
  }
  bool live(long long ms) const { return read_at_ && ms - *read_at_ < STALE_MS; }
  double lux() const { return read_at_ ? std::pow(10.0, ll_) : 0; }  // smoothed

  // The level for floor `min` at ms. Moves only past STEP for HOLD_MS, or
  // straight away when `min` changes (or on the first call).
  double target(double min, long long ms) {
    double want = level(raw_, min);
    if (!held_ || min != min_) {
      held_ = want;
      min_ = min;
      away_.reset();
    } else if (std::fabs(want - *held_) < STEP && !(want != *held_ && (want == min || want == 100))) {
      away_.reset();  // close enough (an end of the range is always reached)
    } else if (!away_) {
      away_ = ms;
    } else if (ms - *away_ >= HOLD_MS) {
      held_ = want;
      away_.reset();
    }
    return *held_;
  }

 private:
  std::optional<long long> read_at_;
  double ll_ = 0, raw_ = 0;
  std::optional<double> held_;
  double min_ = -1;
  std::optional<long long> away_;
};

// A level that eases to its target (linear, over the given time).
class Fade {
 public:
  void set(double to, long long ms, long long over) {
    if (has_ && to == to_) return;
    from_ = has_ ? value(ms) : to;
    to_ = to;
    start_ = ms;
    over_ = over;
    has_ = true;
  }
  double value(long long ms) const {
    if (!has_ || over_ <= 0 || ms - start_ >= over_) return to_;
    double t = (double)(ms - start_) / (double)over_;
    return from_ + (to_ - from_) * std::max(0.0, t);
  }
  bool has() const { return has_; }
  double target() const { return to_; }

 private:
  bool has_ = false;
  double from_ = 100, to_ = 100;
  long long start_ = 0, over_ = 0;
};

}  // namespace light
