// What the board shows at each moment, and when its next animation starts.
// A port of firmware/boardlib/player.py (same names).
//
// The scheduler (sched.h) asks the player two things before any request:
//   busy(ms)      - is an animation running right now?
//   quiet_ms(ms)  - how long until the next one starts?
// A request freezes the animations while it runs (the DMA keeps the panel
// lit), so requests run in long enough gaps (spec §2, "Scheduler").
//
// Platform independent: builds natively for tests.
#pragma once

#include <map>
#include <optional>
#include <string>
#include <vector>

#include "draw.h"
#include "json.h"

namespace player {

using json::Value;

const int RADAR_SLOTS = 6;  // the loop's length (contract: up to 6 frames)
const int LOGO_SLOTS = 4;   // the game on screen and the next one
const double BLINK_START_WINDOW_MS = 150;
const double FAR = 1e9;  // "no animation coming"

class Player {
 public:
  Value p;
  bool has_p = false;
  long gen = 0;  // bumped with every payload
  draw::TransitAnimator anim;
  draw::Frames radar_frames;  // frame id -> bytes
  draw::Logos logos;          // logo id -> 24 x 12 RGB
  int page = 0;
  double page_start = 0;
  double loop_start = 0;
  double blink_shift = 0;  // ms; blink phase 0 (off) starts here
  std::string screen = "transit";
  draw::NumRoller nums;  // header and radar clock rolls

  // ---- inputs ----
  void set_payload(const Value &payload, double ms);
  std::vector<std::string> missing_frames() const;
  bool has_slot() const { return (int)radar_frames.size() < RADAR_SLOTS; }
  void add_frame(const std::string &fid, std::vector<uint8_t> bytes, std::optional<double> ms = std::nullopt);
  std::vector<std::string> wanted_logos(long long now) const;
  bool live_game() const;
  std::vector<std::string> missing_logos(long long now);
  bool has_logo_slot() const { return (int)logos.size() < LOGO_SLOTS; }
  void add_logo(const std::string &lid, std::vector<uint8_t> bytes) { logos[lid] = std::move(bytes); }
  std::string auto_screen(long long now) const;
  bool wants_frames() const;
  void set_screen(const std::string &s, double ms);

  // ---- drawing ----
  void draw(draw::Frame &frame, double ms, long long now);

  // ---- alert blink vs. network fetches ----
  bool blink_on(double ms) const;
  bool blinking() const;
  bool at_blink_start(double ms) const;
  void blink_restart(double ms) { blink_shift = ms; }
  int radar_idx(double ms) const;
  bool rain_bars(double ms) const;
  bool awaiting_drop(long long now) const;
  std::optional<std::string> frame_key(double ms, long long now);

  // ---- timing for the scheduler ----
  bool busy(double ms) const;
  double quiet_ms(double ms, long long now);

 private:
  struct BbRoll {
    draw::ustr from;
    double start;
  };
  std::optional<draw::BaseballTexts> bb_shown_;
  std::map<std::string, BbRoll> bb_rolls_;
  long quiet_gen_ = -1;
  long long quiet_now_ = -1;
  long long quiet_at_ = -1;

  const Value &games() const;
  std::vector<std::string> game_logos(const std::vector<int> &idxs) const;
  void keep_logos(const std::vector<std::string> &want);
  double rain_period(double ms) const;
  int loop_len() const;
  bool screen_busy(double ms) const;
  double screen_quiet_ms(double ms, long long now);
};

bool transit_busy(const draw::TransitAnimator &anim, double t);
std::optional<long long> transit_next_change(const Value &p, long long now);
double transit_quiet_ms(const Value &p, long long now);

}  // namespace player
