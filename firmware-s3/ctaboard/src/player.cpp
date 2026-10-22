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
  if (screen != "baseball" || !has_p) return false;
  const Value &gs = p["mlb"]["games"];
  for (size_t i = 0; i < gs.size(); i++)
    if (gs[i]["st"].eq("live")) return true;
  return false;
}

std::vector<std::string> Player::missing_logos(long long now) {
  // Only while the baseball screen is up. Frees logos the current and
  // next game don't use.
  if (screen != "baseball") return {};
  std::vector<std::string> want = wanted_logos(now);
  keep_logos(want);
  std::vector<std::string> out;
  for (const std::string &i : want)
    if (!logos.count(i)) out.push_back(i);
  return out;
}

std::string Player::auto_screen(long long now) const {
  // The server's `screen`, except that on the auto screen `rot` alternates
  // the main screens every `every` s, and the weather screen is visited for
  // `for` s at the start of every `every`-s cycle while rain is in the box
  // (or always). Both epoch-aligned. Mirrors autoScreen() in draw.js.
  std::string base = has_p && p["screen"].truthy() ? json::str(p["screen"]) : "transit";
  std::string s = base;
  const Value &rot = p["rot"];
  if (rot.truthy() && rot["screens"].size() > 1 && rot["every"].num(0) > 0) {
    const Value &scr = rot["screens"];
    bool in = false;
    for (size_t i = 0; i < scr.size(); i++)
      if (json::str(scr[i]) == base) in = true;
    if (in) s = json::str(scr[(size_t)fmod_floor(fdiv(now, (long long)rot["every"].num()), (long long)scr.size())]);
  }
  const Value &r = p["radar"];
  const Value &v = r["visit"];
  if ((base != "transit" && base != "ticker" && base != "baseball") || !v.truthy() || !(v["every"].num(0) > 0) ||
      !(r["on"].truthy() || v["always"].truthy()))
    return s;
  return fmod_floor(now, (long long)v["every"].num()) < (long long)v["for"].num() ? "weather" : s;
}

bool Player::wants_frames() const {
  // Radar frames are needed on the radar screen, and ahead of visits.
  if (screen == "weather") return true;
  const Value &r = p["radar"];
  return has_p && r["on"].truthy() && r["visit"].truthy();
}

void Player::set_screen(const std::string &s, double ms) {
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
  if (screen == "ticker") {
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
  if (screen == "baseball") {
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
  if (screen == "weather") {
    o.screen = "weather";
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

// ---- alert blink vs. network fetches ----
// A fetch freezes the animations for longer than one blink phase. To make
// that read as one slightly long "on" phase, fetches start right as the
// blink turns on, and the blink restarts (off) when the fetch ends.

bool Player::blink_on(double ms) const {
  return fmod_floor((long long)floor((ms - blink_shift) / draw::BLINK_MS), 2) == 1;
}

bool Player::blinking() const {
  if (!has_p || (screen != "transit" && screen != "weather")) return false;
  const Value &w = p["warn"];
  bool tornado = w["kind"].eq("tor") && w["lvl"].eq("warning");
  if (screen == "weather") return tornado;
  // Line alerts are static; only the weather strip's tornado tag blinks.
  return tornado && p["wx"].truthy();
}

bool Player::at_blink_start(double ms) const {
  if (!blinking()) return true;
  double phase = pymod(ms - blink_shift, 2 * draw::BLINK_MS);
  return draw::BLINK_MS <= phase && phase < draw::BLINK_MS + BLINK_START_WINDOW_MS;
}

int Player::radar_idx(double ms) const {
  return draw::radar_loop_idx(p["radar"]["frames"], &radar_frames, ms - loop_start, draw::timing(p));
}

bool Player::rain_bars(double ms) const {
  // True while the rain bars show in the radar loop's turn.
  const Value &rn = p["radar"]["wx"]["rain"];
  return draw::rain_bars_turn(rn, loop_len(), draw::timing(p), ms - loop_start);
}

double Player::rain_period(double) const {
  // ms in one full turn: the loops, then the bars.
  const Value &rn = p["radar"]["wx"]["rain"];
  int n = loop_len();
  draw::Timing tm = draw::timing(p);
  double cycle = std::max(1, n - 1) * tm.radarFrame + tm.radarHold;
  return (rn["loops"].truthy() ? rn["loops"].num() : 0) * cycle + (rn["alt"].truthy() ? rn["alt"].num() : 0) * 1000;
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
  if (!has_p || (screen != "transit" && screen != "ticker")) return false;
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

std::optional<std::string> Player::frame_key(double ms, long long now) {
  // Everything a still frame depends on, or none while an animation needs
  // every frame. The board redraws only when this changes.
  if ((screen != "weather" && busy(ms)) || nums.busy(ms)) return std::nullopt;
  char buf[160];
  snprintf(buf, sizeof buf, "%s|%ld|%lld|%d", screen.c_str(), gen, now, blinking() && blink_on(ms) ? 1 : 0);
  std::string key = buf;
  if (screen == "ticker") {
    draw::Timing tm = draw::timing(p);
    snprintf(buf, sizeof buf, "|%d|%d", page, ms - page_start >= tm.pageHold + tm.slide ? 1 : 0);
    return key + buf;
  }
  if (screen == "weather") {
    snprintf(buf, sizeof buf, "|%d|%zu|%d", radar_idx(ms), radar_frames.size(), rain_bars(ms) ? 1 : 0);
    return key + buf;
  }
  if (screen == "baseball") {
    snprintf(buf, sizeof buf, "|%zu", logos.size());
    return key + buf;
  }
  return key;
}

// ---- timing for the scheduler ----

bool Player::busy(double ms) const {
  if (!has_p) return false;
  if (nums.busy(ms)) return true;
  return screen_busy(ms);
}

bool Player::screen_busy(double ms) const {
  if (screen == "ticker") {
    double since = ms - page_start;
    draw::Timing tm = draw::timing(p);
    return draw::ticker_pages(p, 0) > 1 && tm.pageHold < since && since < tm.pageHold + tm.slide;
  }
  if (screen == "baseball") {
    for (const auto &kv : bb_rolls_)
      if (ms - kv.second.start < draw::ROLL_MS) return true;
    return false;
  }
  if (screen == "weather") {
    int n = loop_len();
    if (n < 2 || rain_bars(ms)) return false;
    draw::Timing tm = draw::timing(p);
    double cycle = (n - 1) * tm.radarFrame + tm.radarHold;
    return pymod(ms - loop_start, cycle) < (n - 1) * tm.radarFrame;
  }
  return transit_busy(anim, ms);
}

double Player::quiet_ms(double ms, long long now) {
  // ms until the next animation starts (0 while one runs). A clock on
  // screen rolls at the top of every minute.
  if (!has_p) return FAR;
  if (busy(ms)) return 0;
  double q = screen_quiet_ms(ms, now);
  if (nums.clock()) q = std::min(q, (double)(60 - fmod_floor(now, 60)) * 1000);
  return q;
}

double Player::screen_quiet_ms(double ms, long long now) {
  if (screen == "ticker") {
    if (draw::ticker_pages(p, (double)now) < 2) return FAR;
    return std::max(0.0, draw::timing(p).pageHold - (ms - page_start));
  }
  if (screen == "baseball") return FAR;  // rolls follow fetched changes; the rotation swaps without animating
  if (screen == "weather") {
    int n = loop_len();
    if (n < 2 && !rain_bars(ms)) return FAR;
    draw::Timing tm = draw::timing(p);
    if (rain_bars(ms)) {
      // Bars show between two loop turns: the next turn starts the loop again.
      double period = rain_period(ms);
      return period - pymod(ms - loop_start, period);
    }
    double cycle = (n - 1) * tm.radarFrame + tm.radarHold;
    return cycle - pymod(ms - loop_start, cycle);
  }
  if (quiet_gen_ != gen || (now != quiet_now_ && 0 <= quiet_at_ && quiet_at_ <= now)) {
    // A new payload, or the cached change is here. Before it, no shown time
    // changes and no train drops off, so the answer holds; at it, recompute
    // once per second.
    quiet_gen_ = gen;
    quiet_now_ = now;
    std::optional<long long> at = transit_next_change(p, now);
    quiet_at_ = at ? *at : -1;
  }
  if (quiet_at_ < 0) return FAR;
  return std::max(0.0, (double)(quiet_at_ - now) * 1000);
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

std::optional<long long> transit_next_change(const Value &p, long long now) {
  // Epoch second when a shown time next changes (a roll) or a train drops
  // off (a fade): the next minute boundary of any visible arrival.
  draw::View view = draw::build_transit_view(p, (double)now);
  std::optional<long long> best;
  for (const draw::ViewRow &row : view.rows)
    for (const draw::ViewCell &c : row.cells) {
      long long t = (long long)c.t;
      long long m = draw::minutes_until(c.t, (double)now);
      long long at;
      if (m > 1) {
        at = t - 60 * (m - 1);  // when ceil((t - now) / 60) drops to m - 1
      } else {
        at = t + draw::DROP_GRACE;  // DUE until it drops off
        if (at <= now) at += draw::HOLD_MAX;  // held for a fresh payload (draw.is_shown)
      }
      if (!best || at < *best) best = at;
    }
  return best;
}

double transit_quiet_ms(const Value &p, long long now) {
  std::optional<long long> at = transit_next_change(p, now);
  return at ? std::max(0.0, (double)(*at - now) * 1000) : FAR;
}

}  // namespace player
