// Port of firmware/boardlib/player.py; see player.h.

#include "player.h"

#include <math.h>
#include <stdio.h>

#include <algorithm>

namespace player {

using draw::fdiv;
using draw::fmod_floor;

static bool contains(const std::vector<std::string> &v, const std::string &s) {
  return std::find(v.begin(), v.end(), s) != v.end();
}

static double pymod(double a, double b) { return a - floor(a / b) * b; }

// ---- inputs ----

void Player::set_payload(const Value &payload, double ms) {
  // A new station: start transit and the ticker fresh. Animating from the
  // old station's rows to the new one's overlapped them mid-fade.
  if (has_p && json::str(payload["stn"]) != json::str(p["stn"])) {
    anim = draw::TransitAnimator();
    page = 0;
    page_start = ms;
  }
  p = payload;
  has_p = true;
  gen++;
  // Keep only frames still in the loop.
  const Value &ids = p["radar"]["frames"];
  std::vector<std::string> keep;
  for (size_t i = 0; i < ids.size(); i++) keep.push_back(json::str(ids[i]));
  for (auto it = radar_frames.begin(); it != radar_frames.end();) {
    if (!contains(keep, it->first)) it = radar_frames.erase(it);
    else ++it;
  }
  // Keep only logos the games still use.
  std::vector<int> all;
  for (size_t i = 0; i < games().size(); i++) all.push_back((int)i);
  keep_logos(game_logos(all));
}

std::vector<std::string> Player::missing_frames() const {
  // Newest first: the loop plays the frames on hand, so it starts with the current one.
  std::vector<std::string> out;
  if (!has_p) return out;
  const Value &ids = p["radar"]["frames"];
  for (int i = (int)ids.size() - 1; i >= 0; i--) {
    std::string id = json::str(ids[i]);
    if (!radar_frames.count(id)) out.push_back(id);
  }
  return out;
}

void Player::add_frame(const std::string &fid, std::vector<uint8_t> bytes, std::optional<double> ms) {
  // The frame that completes the set restarts the loop at its oldest frame.
  radar_frames[fid] = std::move(bytes);
  if (ms && loop_len()) loop_start = *ms;
}

const Value &Player::games() const {
  const Value &mlb = p["mlb"];
  if (has_p && mlb["layout"].eq("logos") && mlb["games"].truthy()) return mlb["games"];
  return Value::null_value();
}

std::vector<std::string> Player::game_logos(const std::vector<int> &idxs) const {
  const Value &gs = games();
  std::vector<std::string> out;
  for (int i : idxs)
    for (const char *k : {"away", "home"}) {
      const Value &lg = gs[i][k]["lg"];
      if (lg.truthy() && !contains(out, json::str(lg))) out.push_back(json::str(lg));
    }
  return out;
}

void Player::keep_logos(const std::vector<std::string> &want) {
  for (auto it = logos.begin(); it != logos.end();) {
    if (!contains(want, it->first)) it = logos.erase(it);
    else ++it;
  }
}

std::vector<std::string> Player::wanted_logos(long long now) const {
  // The game on screen, then the next one in the rotation (logo layout
  // only). Mirrors draw.pick_game().
  const Value &gs = games();
  if (!gs.truthy()) return {};
  bool all_games = p["mlb"]["all"].is_true();
  draw::PickedGame pick = draw::pick_game(gs, (double)now, draw::timing(p).game, all_games);
  std::vector<int> pool;
  if (!all_games)
    for (size_t i = 0; i < gs.size(); i++)
      if (gs[i]["st"].eq("live")) pool.push_back((int)i);
  if (pool.empty())
    for (size_t i = 0; i < gs.size(); i++) pool.push_back((int)i);
  std::vector<int> idxs = {pick.i};
  if (pick.of > 1) idxs.push_back(pool[(pick.pos + 1) % pick.of]);
  return game_logos(idxs);
}

bool Player::live_game() const {
  // True while the baseball screen is up with a game in progress.
  if (screen != Screen::Baseball || !has_p) return false;
  const Value &gs = p["mlb"]["games"];
  for (size_t i = 0; i < gs.size(); i++)
    if (gs[i]["st"].eq("live")) return true;
  return false;
}

std::vector<std::string> Player::missing_logos(long long now) {
  // Only while the baseball screen is up. Frees logos the current and
  // next game don't use.
  if (screen != Screen::Baseball) return {};
  std::vector<std::string> want = wanted_logos(now);
  keep_logos(want);
  std::vector<std::string> out;
  for (const std::string &i : want)
    if (!logos.count(i)) out.push_back(i);
  return out;
}

std::optional<std::string> Player::missing_cloud() const {
  // The clock screen's skyline draws the server's cloud strip (contract
  // "Cloud strips"); fetched only while that screen shows.
  if (!has_p || screen != Screen::Clock) return std::nullopt;
  const Value &cl = p["skyline"]["cl"];
  if (!cl.truthy() || !cl["id"].is_str()) return std::nullopt;
  std::string id = json::str(cl["id"]);
  if (id.empty() || clouds.count(id)) return std::nullopt;
  return id;
}

void Player::add_cloud(const std::string &id, std::vector<uint8_t> bytes) {
  clouds.clear();  // one strip at a time: a new sky replaces the old one
  clouds[id] = std::move(bytes);
}

Screen Player::auto_screen(long long now) const {
  // The server's `screen`, except that on the auto screen `rot` alternates
  // the main screens every `every` s, and the weather screen is visited for
  // `for` s at the start of every `every`-s cycle while rain is in the box
  // (or always). Both epoch-aligned. Mirrors autoScreen() in draw.js.
  static const std::string TRANSIT = "transit";
  const Value &ps = p["screen"];
  const std::string &base_name = has_p && ps.is_str() && ps.truthy() ? ps.s : TRANSIT;
  Screen base = screen::from(base_name);
  Screen s = base;
  const Value &rot = p["rot"];
  if (rot.truthy() && rot["screens"].size() > 1 && rot["every"].num(0) > 0) {
    const Value &scr = rot["screens"];
    bool in = false;
    for (size_t i = 0; i < scr.size(); i++)
      if (scr[i].str_or("") == base_name) in = true;
    if (in) s = screen::from(scr[(size_t)fmod_floor(fdiv(now, (long long)rot["every"].num()), (long long)scr.size())].str_or(""));
  }
  const Value &r = p["radar"];
  const Value &v = r["visit"];
  if ((base != Screen::Transit && base != Screen::Ticker && base != Screen::Baseball) || !v.truthy() ||
      !(v["every"].num(0) > 0) || !(r["on"].truthy() || v["always"].truthy()))
    return s;
  return fmod_floor(now, (long long)v["every"].num()) < (long long)v["for"].num() ? Screen::Weather : s;
}

bool Player::wants_frames() const {
  // Radar frames are needed on the radar screen, and ahead of visits.
  if (screen == Screen::Weather) return true;
  const Value &r = p["radar"];
  return has_p && r["on"].truthy() && r["visit"].truthy();
}

void Player::set_screen(Screen s, double ms) {
  if (s != screen) {
    screen = s;
    page = 0;
    page_start = ms;
    loop_start = ms;
    anim = draw::TransitAnimator();
    bb_shown_.reset();
    bb_rolls_.clear();
    nums.reset();
  }
}

// ---- drawing ----

void Player::draw(draw::Frame &frame, double ms, long long now) {
  // Render the current screen at monotonic ms / epoch now. The header and
  // radar clocks roll at the minute (NumRoller; render() ends its frame).
  nums.begin(ms);
  draw::RenderOpts o;
  o.now = (double)now;
  o.roller = &nums;
  o.apply_bright = !hw_bright;
  o.bright = bright;
  if (screen == Screen::Ticker) {
    int pages = draw::ticker_pages(p, (double)now);
    if (page >= pages) page = 0;
    double since = ms - page_start;
    draw::Timing tm = draw::timing(p);
    if (since >= tm.pageHold + tm.slide) {
      page = (page + 1) % pages;
      page_start = ms;
      since = 0;
    }
    o.screen = "ticker";
    o.page = page;
    o.slide = pages > 1 && since > tm.pageHold ? (since - tm.pageHold) / tm.slide : 0;
    draw::render(p, frame, o);
    return;
  }
  if (screen == Screen::Baseball) {
    // Scores, inning, count, and outs roll when they change (not across a
    // change of game or state). Mirrors sim.html.
    std::optional<draw::BaseballTexts> bt = draw::baseball_texts(p, (double)now);
    if (bt && bb_shown_ && bb_shown_->key == bt->key) {
      for (const auto &kv : bt->texts) {
        auto old = bb_shown_->texts.find(kv.first);
        if (old != bb_shown_->texts.end() && old->second != kv.second) bb_rolls_[kv.first] = BbRoll{old->second, ms};
      }
    } else {
      bb_rolls_.clear();
    }
    bb_shown_ = bt;
    draw::Rolls rolls;
    for (auto it = bb_rolls_.begin(); it != bb_rolls_.end();) {
      double rp = (ms - it->second.start) / draw::ROLL_MS;
      if (rp >= 1) {
        it = bb_rolls_.erase(it);
      } else {
        rolls[it->first] = draw::Roll{it->second.from, rp};
        ++it;
      }
    }
    o.screen = "baseball";
    o.rolls = &rolls;
    o.logos = &logos;
    draw::render(p, frame, o);
    return;
  }
  if (screen == Screen::Clock) {
    // Skyline face: ambient motion on the wall clock (boats on the quarter hour).
    o.screen = "clock";
    o.ms = wall_ms;
    o.clouds = &clouds;
    o.blink = blink_on(ms);
    draw::render(p, frame, o);
    return;
  }
  if (screen == Screen::Weather) {
    o.screen = "weather";
    o.icon_t = ms;  // animated icons (the layouts in radar.iconAnim)
    o.idx = radar_idx(ms);
    o.frames = &radar_frames;
    o.blink = blink_on(ms);
    o.t = ms - loop_start;
    draw::render(p, frame, o);
    return;
  }
  draw::View view = anim.step(p, (double)now, ms);
  o.screen = "transit";
  o.view = &view;
  o.blink = blink_on(ms);
  draw::render(p, frame, o);
}

// ---- alert blink ----

bool Player::blink_on(double ms) const { return fmod_floor((long long)floor(ms / draw::BLINK_MS), 2) == 1; }

bool Player::blinking() const {
  if (!has_p || (screen != Screen::Transit && screen != Screen::Weather && screen != Screen::Clock)) return false;
  const Value &w = p["warn"];
  bool tornado = w["kind"].eq("tor") && w["lvl"].eq("warning");
  if (screen == Screen::Weather || screen == Screen::Clock) return tornado;  // the clock's warning label blinks too
  // Line alerts are static; only the weather strip's tornado tag blinks.
  return tornado && p["wx"].truthy();
}

int Player::radar_idx(double ms) const {
  return draw::radar_loop_idx(p["radar"]["frames"], &radar_frames, ms - loop_start, draw::timing(p));
}

bool Player::rain_bars(double ms) const {
  // True while the rain bars show in the radar loop's turn.
  const Value &rn = p["radar"]["wx"]["rain"];
  return draw::rain_bars_turn(rn, loop_len(), draw::timing(p), ms - loop_start);
}

int Player::loop_len() const {
  // Frames in the playing loop: all of them once every frame is on hand,
  // else 0 (the screen holds on the newest on hand).
  if (!has_p) return 0;
  const Value &ids = p["radar"]["frames"];
  return ids.truthy() && draw::radar_on_hand(ids, &radar_frames) == (int)ids.size() ? (int)ids.size() : 0;
}

bool Player::awaiting_drop(long long now) const {
  // True while a train on the transit or ticker screen is past its drop
  // time but the payload predates that moment (draw.is_shown holds it):
  // fetch now so the server says whether it's gone or held.
  if (!has_p || (screen != Screen::Transit && screen != Screen::Ticker)) return false;
  const Value &pnow_v = p["now"];
  if (pnow_v.is_null()) return false;
  double pnow = pnow_v.num();
  auto check = [&](double x) {
    return x + draw::DROP_GRACE <= now && now <= x + draw::DROP_GRACE + draw::HOLD_MAX && pnow < x + draw::DROP_GRACE;
  };
  const Value &rows = p["rows"];
  for (size_t i = 0; i < rows.size(); i++)
    for (size_t k = 0; k < rows[i]["t"].size(); k++)
      if (check(rows[i]["t"][k].num())) return true;
  const Value &tk = p["ticker"];
  for (size_t i = 0; i < tk.size(); i++)
    if (check(tk[i]["t"].num())) return true;
  return false;
}

std::optional<screen::FrameKey> Player::frame_key(double ms, long long now) {
  // Everything a still frame depends on, or none while an animation needs
  // every frame. The board redraws only when this changes.
  if ((screen != Screen::Weather && busy(ms)) || nums.busy(ms)) return std::nullopt;
  screen::FrameKey k;
  k.v[0] = (long long)screen;
  k.v[1] = gen;
  k.v[2] = now;
  k.v[3] = blinking() && blink_on(ms);
  switch (screen) {
    case Screen::Ticker: {
      draw::Timing tm = draw::timing(p);
      k.v[4] = page;
      k.v[5] = ms - page_start >= tm.pageHold + tm.slide;
      break;
    }
    case Screen::Weather:
      // Animated icons change on their own clock: redraw every frame. They're
      // ambient, so they don't count as busy.
      if (p["radar"]["iconAnim"].size() > 0) return std::nullopt;
      k.v[4] = radar_idx(ms) * 2 + (rain_bars(ms) ? 1 : 0);
      k.v[5] = (long long)radar_frames.size();
      break;
    case Screen::Baseball:
      k.v[4] = (long long)logos.size();
      break;
    case Screen::Clock:
      // The skyline moves on a 100 ms tick: redraw ten times a second.
      k.v[4] = (long long)floor(wall_ms / 100);
      k.v[5] = (long long)clouds.size();
      break;
    case Screen::Transit:
      break;
  }
  return k;
}

// ---- animation ----

bool Player::busy(double ms) const {
  if (!has_p) return false;
  if (nums.busy(ms)) return true;
  return screen_busy(ms);
}

bool Player::screen_busy(double ms) const {
  if (screen == Screen::Ticker) {
    double since = ms - page_start;
    draw::Timing tm = draw::timing(p);
    return draw::ticker_pages(p, 0) > 1 && tm.pageHold < since && since < tm.pageHold + tm.slide;
  }
  if (screen == Screen::Baseball) {
    for (const auto &kv : bb_rolls_)
      if (ms - kv.second.start < draw::ROLL_MS) return true;
    return false;
  }
  if (screen == Screen::Weather) {
    int n = loop_len();
    if (n < 2 || rain_bars(ms)) return false;
    draw::Timing tm = draw::timing(p);
    double cycle = (n - 1) * tm.radarFrame + tm.radarHold;
    return pymod(ms - loop_start, cycle) < (n - 1) * tm.radarFrame;
  }
  return transit_busy(anim, ms);
}

bool transit_busy(const draw::TransitAnimator &anim, double t) {
  // True while any transit row or time is fading, moving, rolling, or
  // easing color (mirrors the timing in TransitAnimator::step).
  auto tr = [](const std::optional<double> &v) { return v.has_value() && *v != 0; };
  for (const auto &kv : anim.rows) {
    const draw::TransitAnimator::RowState &st = *kv.second;
    if (tr(st.leaving)) return true;
    if (st.born && t - *st.born < draw::FADE_MS * 2) return true;
    if (st.moveStart && t < *st.moveStart + draw::MOVE_MS) return true;
    if (st.has_numRoll) return true;
    for (const auto &cp : st.cells) {
      const draw::TransitAnimator::CellState &c = *cp;
      if (tr(c.leaving) || c.has_roll) return true;
      if (c.born && t - *c.born < draw::FADE_MS) return true;
      if (c.colorStart && t - *c.colorStart < draw::COLOR_MS) return true;
      if (c.moveStart && t < *c.moveStart + draw::MOVE_MS) return true;
    }
  }
  return false;
}

}  // namespace player
