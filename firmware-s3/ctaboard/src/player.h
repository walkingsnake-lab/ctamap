// What the board shows at each moment, and whether it's animating.
// Ported from firmware/boardlib/player.py (most names follow it).
//
// busy(ms) says whether an animation is running right now: the board
// redraws every frame while it is, and starts an OTA install (which blocks
// the loop) only when it isn't.
//
// Platform independent: builds natively for tests.
#pragma once

#include <map>
#include <optional>
#include <string>
#include <vector>

#include "draw.h"
#include "json.h"
#include "screen.h"

namespace player {

using json::Value;
using screen::Screen;

const int RADAR_SLOTS = 6;  // the loop's length (contract: up to 6 frames)
const int LOGO_SLOTS = 4;   // the game on screen and the next one

class Player {
 public:
  Value p;
  bool has_p = false;
  bool hw_bright = false;  // the display dims it all in hardware: draw at full brightness
  std::optional<double> bright;  // percent the renderer scales by (Board); none: the payload's
  long gen = 0;  // bumped with every payload
  draw::TransitAnimator anim;
  bool night = false;  // the last transit frame had no rows: the overnight owl
  draw::Frames radar_frames;  // frame id -> bytes
  draw::Logos logos;          // logo id -> 24 x 12 RGB
  int page = 0;
  double page_start = 0;
  double loop_start = 0;
  Screen screen = Screen::Transit;
  draw::NumRoller nums;  // header and radar clock rolls
  draw::Frames clouds;   // the skyline's cloud strips on hand: id -> 1664 packed bytes (those sky_fade still needs)
  draw::SkylineFader sky_fade;  // the skyline on screen and the crossfade from the last
  double wall_ms = 0;    // epoch ms, set by the Board before drawing (the skyline's animation clock)
  double msg_start = 0;  // when the announce screen's message appeared (its intro plays from here)
  long long visit_skip_until = 0;  // epoch s: no Rain nearby visit before then (the knob ended one)

  // ---- inputs ----
  void set_payload(const Value &payload, double ms) { set_payload(Value(payload), ms); }
  void set_payload(Value &&payload, double ms);
  std::vector<std::string> frame_ids() const;
  std::vector<std::string> missing_frames() const;
  bool has_slot() const { return (int)radar_frames.size() < RADAR_SLOTS; }
  void add_frame(const std::string &fid, std::vector<uint8_t> bytes, std::optional<double> ms = std::nullopt);
  std::vector<std::string> wanted_logos(long long now) const;
  bool live_game() const;
  std::vector<std::string> missing_logos(long long now);
  bool has_logo_slot() const { return (int)logos.size() < LOGO_SLOTS; }
  // Skyline face: the cloud strip the payload names, when it isn't on hand.
  std::optional<std::string> missing_cloud() const;
  void add_cloud(const std::string &id, std::vector<uint8_t> bytes);
  void prune_clouds();  // drop strips the skyline fader no longer needs
  void add_logo(const std::string &lid, std::vector<uint8_t> bytes) { logos[lid] = std::move(bytes); }
  Screen auto_screen(long long now) const;
  // A Rain nearby visit is showing now (the screen would be another without it).
  bool visiting(long long now) const;
  bool wants_frames() const;
  void set_screen(Screen s, double ms);

  // ---- drawing ----
  void draw(draw::Frame &frame, double ms, long long now);

  // ---- alert blink ----
  bool blink_on(double ms) const;
  bool blinking() const;
  int radar_idx(double ms) const;
  bool rain_bars(double ms) const;
  bool awaiting_drop(long long now) const;
  std::optional<screen::FrameKey> frame_key(double ms, long long now);

  // ---- animation ----
  bool busy(double ms) const;

 private:
  struct BbRoll {
    draw::ustr from;
    double start;
  };
  std::optional<draw::BaseballTexts> bb_shown_;
  std::map<std::string, BbRoll> bb_rolls_;

  const Value &games() const;
  std::vector<std::string> game_logos(const std::vector<int> &idxs) const;
  void keep_logos(const std::vector<std::string> &want);
  int loop_len() const;
  bool screen_busy(double ms) const;
};

bool transit_busy(const draw::TransitAnimator &anim, double t);

}  // namespace player
