// The board's main loop (src/app.cpp) against a simulated server, clock,
// display, and buttons: the C++ twin of firmware/tests/test_app.py, with the
// same scenarios. Requests take simulated time, so these check the
// scheduling the board depends on: fetches land in animation gaps, data
// stays fresh, settings changes show up fast, radar frames and logos are
// fetched only when needed, and buttons follow "last action wins".
//   app_test   (exit status 0 when every test passes)

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include <memory>

#include <algorithm>
#include <functional>
#include <set>
#include <string>
#include <vector>

#include "../ctaboard/src/app.h"
#include "../ctaboard/src/draw.h"
#include "../ctaboard/src/json.h"
#include "../ctaboard/src/player.h"

using json::Value;

static const long long T0 = 1791140000;  // epoch seconds at the start of each simulation
static const long long LATENCY = 1500;   // ms per request

// ---- a tiny test runner ----

static int g_failed = 0, g_checks = 0;
static std::string g_test;
#define CHECK(cond, ...)                                                    \
  do {                                                                      \
    g_checks++;                                                             \
    if (!(cond)) {                                                          \
      g_failed++;                                                           \
      printf("FAIL %s (line %d): %s", g_test.c_str(), __LINE__, #cond);     \
      printf(" " __VA_ARGS__);                                              \
      printf("\n");                                                         \
    }                                                                       \
  } while (0)

// ---- fakes ----

struct SimClock : app::Clock {
  long long t = 0;
  long long ms() override { return t; }
  void sleep_ms(long long ms) override { t += std::max(0LL, ms); }
};

struct Call {
  std::string name;
  long long ms;
  bool has_state = false;
  bool busy = false;
  double quiet = 0, budget = 0, phase = 0;
};

static Value parse(const std::string &s) {
  Value v;
  std::string err;
  if (!json::parse(s, v, &err)) {
    printf("bad test JSON: %s\n%s\n", err.c_str(), s.c_str());
    exit(2);
  }
  return v;
}

static std::string jnum(long long n) { return std::to_string(n); }

struct Server : app::Net {
  SimClock *clock;
  app::Board *board = nullptr;
  long v = 1;
  std::string screen = "transit";
  bool radar_on = false;
  std::vector<Call> calls;
  int fail_next = 0;
  std::vector<std::string> health, update_screens;
  std::function<std::string(long long)> games;  // JSON array of games
  std::vector<std::string> wifi = {"ok"};
  std::string visit = "null";
  int alert = 0;
  int tornado = 0;
  std::string layout = "classic";
  int bright = 100;
  std::function<long long()> latency = [] { return LATENCY; };
  std::function<std::string(long long)> rows_fn;  // JSON array of rows

  explicit Server(SimClock *c) : clock(c) {}

  double now() const { return T0 + clock->t / 1000.0; }

  bool call(const std::string &name, std::string &err) {
    Call rec{name, clock->t};
    if (board && board->player.has_p) {
      long long ms = clock->t;
      rec.has_state = true;
      rec.busy = board->player.busy((double)ms);
      rec.quiet = board->player.quiet_ms((double)ms, board->now(ms));
      rec.budget = board->sched.budget_ms;
      rec.phase = fmod(ms - board->player.blink_shift, 2000);
      if (rec.phase < 0) rec.phase += 2000;
    }
    calls.push_back(rec);
    clock->t += latency();
    if (fail_next) {
      fail_next--;
      err = "OSError";
      return false;
    }
    return true;
  }

  std::string payload() {
    long long now = (long long)floor(this->now());
    std::string rows;
    std::string ticker;
    if (rows_fn) {
      rows = rows_fn(now);
      ticker = "[]";
    } else {
      auto times = [&](long long off) {
        std::string s = "[";
        for (int k = 0; k < 3; k++) s += (k ? "," : "") + jnum(now + off + k * 240 - now % 240);
        return s + "]";
      };
      rows = "[{\"ln\":\"RD\",\"lbl\":\"HOWARD\",\"t\":" + times(75) + ",\"s\":[0,0,0],\"a\":" + jnum(alert) +
             "},{\"ln\":\"RD\",\"lbl\":\"95TH\",\"t\":" + times(130) + ",\"s\":[0,0,0],\"a\":0}]";
      ticker = "[";
      for (int k = 0; k < 3; k++)
        ticker += (k ? "," : "") + std::string("{\"ln\":\"RD\",\"d\":\"Howard\",\"t\":") + jnum(now + 75 + k * 240 - now % 240) + ",\"s\":0,\"a\":0}";
      for (int k = 0; k < 3; k++)
        ticker += std::string(",{\"ln\":\"RD\",\"d\":\"95th\",\"t\":") + jnum(now + 130 + k * 240 - now % 240) + ",\"s\":0,\"a\":0}";
      ticker += "]";
    }
    std::string frames = "[", ft = "[";
    if (radar_on)
      for (int k = player::RADAR_SLOTS - 1; k >= 0; k--) {
        frames += std::string(frames.size() > 1 ? "," : "") + "\"40100-" + jnum(now / 360 * 360 - k * 360) + "\"";
        ft += std::string(ft.size() > 1 ? "," : "") + jnum(T0);
      }
    frames += "]";
    ft += "]";
    std::string game_list = games ? games(now)
                                  : "[{\"id\":1,\"st\":\"live\",\"start\":" + jnum(now - 3600) +
                                        ",\"inn\":3,\"half\":\"T\",\"b\":0,\"s\":0,\"o\":0,\"on\":[0,0,0],"
                                        "\"away\":{\"ab\":\"CHC\",\"c\":\"#2a5bd8\",\"r\":1,\"lg\":" +
                                        (layout == "logos" ? "\"CHC-1\"" : "null") +
                                        ",\"bd\":\"#204882\"},\"home\":{\"ab\":\"STL\",\"c\":\"#d62a2a\",\"r\":0,\"lg\":" +
                                        (layout == "logos" ? "\"STL-1\"" : "null") + ",\"bd\":\"#c12626\"}}]";
    std::string scr = radar_on && visit == "null" ? "weather" : screen;
    return "{\"v\":" + jnum(v) + ",\"now\":" + jnum(now) + ",\"tzo\":-18000,\"age\":3,\"screen\":\"" + scr +
           "\",\"bright\":" + jnum(bright) + ",\"header\":\"MORSE\",\"view\":\"dest\",\"rows\":" + rows + ",\"ticker\":" + ticker +
           ",\"wx\":" + (tornado ? "{\"icon\":\"storm\",\"temp\":70,\"word\":\"STORMS\"}" : "null") +
           ",\"warn\":" + (tornado ? "{\"kind\":\"tor\",\"lvl\":\"warning\"}" : "null") +
           ",\"radar\":{\"on\":" + (radar_on ? "true" : "false") + ",\"visit\":" + visit + ",\"frames\":" + frames +
           ",\"ft\":" + ft + ",\"timeBox\":[40,0,24,22],\"split\":false},\"mlb\":{\"layout\":\"" + layout +
           "\",\"games\":" + game_list + "}}";
  }

  app::ConnectResult connect(const app::Networks &networks, const app::StatusFn &status) override {
    for (const auto &n : networks) {
      status("connecting", n.first);
      clock->t += 3000;
    }
    std::string result = wifi.size() > 1 ? wifi.front() : wifi[0];
    if (wifi.size() > 1) wifi.erase(wifi.begin());
    if (result == "ok") return {"ok", networks[0].first};
    return {result, result == "portal" ? "aa:bb:cc:dd:ee:ff" : ""};
  }

  bool version(const std::string &h, Value &out, std::string &err) override {
    if (!call("version", err)) return false;
    health.push_back(h);
    out = parse("{\"v\":" + jnum(v) + ",\"now\":" + jnum((long long)floor(now())) + "}");
    return true;
  }

  bool update(bool boot, const std::string &scr, Value &out, std::string &err) override {
    if (!call(boot ? "update-boot" : "update", err)) return false;
    update_screens.push_back(scr);
    out = parse(payload());
    return true;
  }

  bool radar(const std::string &id, std::vector<uint8_t> &out, std::string &err) override {
    if (!call("radar:" + id, err)) return false;
    long long n = atoll(id.substr(id.rfind('-') + 1).c_str());
    out.assign(1024, (uint8_t)(n % 251 + 1));
    return true;
  }

  bool logo(const std::string &id, std::vector<uint8_t> &out, std::string &err) override {
    if (!call("logo:" + id, err)) return false;
    int sum = 0;
    for (char c : id) sum += (uint8_t)c;
    out.assign(24 * 12 * 3, (uint8_t)(sum % 251 + 1));
    return true;
  }

  int count(const std::string &prefix) const {
    int n = 0;
    for (const Call &c : calls)
      if (c.name.compare(0, prefix.size(), prefix) == 0) n++;
    return n;
  }
  std::vector<long long> times(const std::string &prefix) const {
    std::vector<long long> out;
    for (const Call &c : calls)
      if (c.name.compare(0, prefix.size(), prefix) == 0) out.push_back(c.ms);
    return out;
  }
};

struct SimDisplay : app::Display {
  SimClock *clock;
  long frames = 0;
  bool hw = false;   // dims in hardware (like the S3's panel)
  double k = -1;     // last brightness set
  int max_px = 0;    // brightest channel in the last frame
  explicit SimDisplay(SimClock *c) : clock(c) {}
  void show(const std::function<void(draw::Frame &)> &fn) override {
    draw::Frame f;
    fn(f);
    frames++;
    max_px = 0;
    for (uint8_t v : f.px) max_px = std::max(max_px, (int)v);
    clock->t += 20;  // render cost
  }
  bool set_brightness(double kk) override {
    k = kk;
    return hw;
  }
};

struct SimButtons : app::Buttons {
  bool held_up = false, held_down = false;
  bool up() override { return held_up; }
  bool down() override { return held_down; }
};

struct SimLed : app::Led {
  SimClock *clock;
  std::string state;
  std::vector<std::string> log;
  explicit SimLed(SimClock *c) : clock(c) {}
  void set(const std::string &name) override {
    if (name != state) {
      state = name;
      log.push_back(name);
    }
  }
};

struct Rig {
  SimClock clock;
  Server server{&clock};
  SimDisplay display{&clock};
  SimButtons btn;
  SimLed led{&clock};
  std::vector<std::string> statuses;
  std::vector<std::string> led_during;  // LED state while each request blocks
  std::unique_ptr<app::Board> board;

  explicit Rig(std::vector<std::string> wifi = {"ok"}, bool buttons = false, bool with_led = false,
               long long start_ms = 0, std::string started = "", std::string crash = "") {
    clock.t = start_ms;
    server.wifi = wifi;
    board.reset(new app::Board(&server, &display, &clock, {{"home", "pw"}, {"phone", "pw"}}, buttons ? &btn : nullptr,
                               nullptr, nullptr, started, crash, with_led ? &led : nullptr));
    server.board = board.get();
    board->on_status = [this](const std::string &k) { statuses.push_back(k); };
  }

  void run_for(long long ms, long long every = 5) {
    long long end = clock.t + ms;
    while (clock.t < end) {
      board->step();
      clock.sleep_ms(every);
    }
  }
};

static long long max_gap(const std::vector<long long> &t) {
  long long g = 0;
  for (size_t i = 1; i < t.size(); i++) g = std::max(g, t[i] - t[i - 1]);
  return g;
}

// ---- tests ----

static void test_a_held_train_stays_due_until_the_server_drops_it() {
  // The CTA pushes a due train's time later (held at a station). The board
  // must not drop the train on its old time, then bring it back. Run at
  // several offsets against the board's 30 s update phase.
  for (int off = 0; off < 30; off += 3) {
    Rig r;
    long long b0 = T0 + off;
    r.server.rows_fn = [b0](long long now) {
      long long t = now < b0 + 95 ? b0 + 90 : b0 + 170;  // held: its time moves later
      std::string list;
      for (long long x : {t, b0 + 900})
        if (x >= now - draw::DROP_GRACE) list += (list.empty() ? "" : ",") + jnum(x);
      long n = list.empty() ? 0 : (long)std::count(list.begin(), list.end(), ',') + 1;
      std::string s;
      for (long i = 0; i < n; i++) s += i ? ",0" : "0";
      return "[{\"ln\":\"BR\",\"lbl\":\"KIMBALL\",\"t\":[" + list + "],\"s\":[" + s + "],\"a\":0}]";
    };
    r.board->connect();
    std::vector<std::pair<long long, bool>> shown;
    long long end = r.clock.t + (260 + off) * 1000LL;
    while (r.clock.t < end) {
      r.board->step();
      long long now = r.board->now(r.clock.t);
      draw::View view = draw::build_transit_view(r.board->player.p, (double)now);
      bool on = false;
      for (const auto &row : view.rows)
        for (const auto &c : row.cells)
          if (c.t < b0 + 900) on = true;
      shown.emplace_back(now, on);
      r.clock.sleep_ms(50);
    }
    int gaps = 0, late = 0;
    for (const auto &s : shown) {
      if (s.first >= b0 + 30 && s.first < b0 + 200 && !s.second) gaps++;
      if (s.first >= b0 + 215 && s.second) late++;
    }
    CHECK(gaps == 0, "offset %d: the held train vanished on stale data", off);
    CHECK(late == 0, "offset %d: it stayed after the server dropped it", off);
  }
}

static void test_fetches_land_in_gaps_and_data_stays_fresh() {
  Rig r;
  r.board->connect();
  CHECK(r.server.calls[0].name == "update-boot", "%s", r.server.calls[0].name.c_str());
  r.run_for(10 * 60 * 1000);
  int fetches = 0, in_gap = 0;
  for (size_t i = 1; i < r.server.calls.size(); i++) {
    const Call &c = r.server.calls[i];
    if (!c.has_state) continue;
    fetches++;
    if (!c.busy && c.quiet >= c.budget) in_gap++;
  }
  CHECK(fetches > 50, "%d", fetches);
  CHECK(in_gap >= fetches - r.board->stats.forced, "%d of %d in gaps", in_gap, fetches);
  CHECK(r.board->stats.forced <= 2, "%ld forced", r.board->stats.forced);
  CHECK(max_gap(r.server.times("update")) <= 62000, "%lld", max_gap(r.server.times("update")));
  CHECK(max_gap(r.server.times("version")) <= 32000, "%lld", max_gap(r.server.times("version")));
  CHECK(r.board->sched.budget_ms >= 1500 && r.board->sched.budget_ms <= 2200, "%f", r.board->sched.budget_ms);
}

static void test_settings_change_shows_up_fast() {
  Rig r;
  r.board->connect();
  r.run_for(15000);
  r.server.v = 2;
  r.server.screen = "ticker";
  long long changed_at = r.clock.t;
  while (r.board->player.screen != "ticker" && r.clock.t - changed_at < 30000) {
    r.board->step();
    r.clock.sleep_ms(5);
  }
  CHECK(r.board->player.screen == "ticker", "phone change took too long");
  CHECK(r.board->player.p["v"].num() == 2, "");
}

static void test_radar_frames_only_on_the_radar_screen_and_once_each() {
  Rig r;
  r.board->connect();
  r.run_for(60000);
  CHECK(r.server.count("radar") == 0, "");
  r.server.radar_on = true;
  r.server.v = 2;
  r.run_for(90000);
  CHECK(r.board->player.screen == "weather", "%s", r.board->player.screen.c_str());
  std::set<std::string> names;
  for (const Call &c : r.server.calls)
    if (c.name.compare(0, 5, "radar") == 0) names.insert(c.name);
  CHECK((int)names.size() == r.server.count("radar"), "a frame was fetched twice");
  CHECK(r.board->player.missing_frames().empty(), "");
}

static void test_radar_frames_stay_current_over_many_loops() {
  Rig r;
  r.server.radar_on = true;
  r.board->connect();
  r.run_for(40 * 60 * 1000);  // the loop turns over 3+ times
  CHECK(r.server.count("radar") >= 2 * player::RADAR_SLOTS, "%d", r.server.count("radar"));
  CHECK(r.board->player.missing_frames().empty(), "");
  CHECK((int)r.board->player.radar_frames.size() <= player::RADAR_SLOTS, "");
  for (const auto &kv : r.board->player.radar_frames) {
    long long n = atoll(kv.first.substr(kv.first.rfind('-') + 1).c_str());
    CHECK(kv.second[0] == (uint8_t)(n % 251 + 1), "frame %s holds stale data", kv.first.c_str());
  }
}

static void test_radar_loop_fills_in_back_to_back() {
  Rig r;
  r.board->connect();
  r.run_for(30000);
  r.server.radar_on = true;
  r.server.v = 2;
  r.run_for(60000);
  std::vector<long long> f = r.server.times("radar");
  CHECK(f.size() == (size_t)player::RADAR_SLOTS || f.size() == (size_t)player::RADAR_SLOTS + 1, "%zu", f.size());
  if (f.size() >= (size_t)player::RADAR_SLOTS)
    CHECK(f[player::RADAR_SLOTS - 1] - f[0] < player::RADAR_SLOTS * (LATENCY + 500), "%lld", f[player::RADAR_SLOTS - 1] - f[0]);
}

static void test_logos_only_on_the_baseball_screen_and_once_each() {
  Rig r;
  r.server.layout = "logos";
  r.board->connect();
  r.run_for(60000);
  CHECK(r.server.count("logo") == 0, "transit: none");
  r.server.screen = "baseball";
  r.server.v = 2;
  r.run_for(90000);
  CHECK(r.board->player.screen == "baseball", "");
  std::vector<std::string> got;
  for (const Call &c : r.server.calls)
    if (c.name.compare(0, 4, "logo") == 0) got.push_back(c.name);
  std::sort(got.begin(), got.end());
  CHECK(got == std::vector<std::string>({"logo:CHC-1", "logo:STL-1"}), "%zu", got.size());
  CHECK(r.board->player.missing_logos(r.board->now(r.clock.t)).empty(), "");
  r.server.layout = "bands";  // bands use no logos: the cache empties
  r.server.v = 3;
  r.run_for(30000);
  CHECK(r.board->player.logos.empty(), "");
}

static void test_logos_hold_the_current_and_next_game() {
  // Three pregame games rotate a minute each. The board holds the one on
  // screen and the next (fetched ahead), never more than 4 logos.
  Rig r;
  r.server.layout = "logos";
  r.server.screen = "baseball";
  r.server.games = [](long long now) {
    const char *teams[][2] = {{"CHC", "STL"}, {"CWS", "CLE"}, {"NYY", "BOS"}};
    std::string s = "[";
    for (int i = 0; i < 3; i++) {
      s += std::string(i ? "," : "") + "{\"id\":" + jnum(i + 1) + ",\"st\":\"pre\",\"start\":" + jnum(now + 3600) +
           ",\"away\":{\"ab\":\"" + teams[i][0] + "\",\"c\":\"#2a5bd8\",\"r\":0,\"lg\":\"" + teams[i][0] +
           "-1\",\"bd\":\"#204882\"},\"home\":{\"ab\":\"" + teams[i][1] + "\",\"c\":\"#d62a2a\",\"r\":0,\"lg\":\"" +
           teams[i][1] + "-1\",\"bd\":\"#c12626\"}}";
    }
    return s + "]";
  };
  r.board->connect();
  int shown_without = 0;
  for (int k = 0; k < 5 * 60 * 20; k++) {
    r.board->step();
    r.clock.sleep_ms(50);
    long long now = r.board->now(r.clock.t);
    const Value &gs = r.board->player.p["mlb"]["games"];
    draw::PickedGame pk = draw::pick_game(gs, (double)now, 60, false);
    for (const char *side : {"away", "home"})
      if (!r.board->player.logos.count(json::str(gs[pk.i][side]["lg"])) && r.clock.t > 20000) shown_without++;
    CHECK((int)r.board->player.logos.size() <= player::LOGO_SLOTS, "");
  }
  CHECK(shown_without == 0, "%d frames showed a game without its logos", shown_without);
}

static void test_a_button_press_fetches_the_new_screens_sections_right_away() {
  Rig r({"ok"}, true);
  r.board->connect();
  r.run_for(40000);
  size_t before = r.server.update_screens.size();
  r.btn.held_down = true;
  r.run_for(100);
  r.btn.held_down = false;
  long long pressed_at = r.clock.t;
  while (r.server.update_screens.size() == before && r.clock.t - pressed_at < 3000) {
    r.board->step();
    r.clock.sleep_ms(5);
  }
  CHECK(r.server.update_screens.size() > before, "no update after the press");
  CHECK(r.server.update_screens.back() == r.board->player.screen, "");
  CHECK(r.server.update_screens.back() == "ticker", "%s", r.server.update_screens.back().c_str());
}

static void test_health_rides_on_the_version_check_once_a_minute() {
  Rig r;
  r.board->mem_free = [] { return 26000L; };
  r.board->largest_block = [] { return 4032L; };
  r.board->connect();
  r.server.fail_next = 1;
  r.run_for(150000);
  std::vector<std::string> sent;
  for (const std::string &h : r.server.health)
    if (!h.empty()) sent.push_back(h);
  bool all = !sent.empty();
  for (const std::string &h : sent)
    if (h.compare(0, 4, "&hu=") != 0) all = false;
  CHECK(all, "");
  CHECK(sent.back().find("&hm=26000") != std::string::npos, "%s", sent.back().c_str());
  CHECK(sent.back().find("&hl=4032") != std::string::npos, "%s", sent.back().c_str());
  CHECK(sent.back().find("&hf=1") != std::string::npos, "%s", sent.back().c_str());
  CHECK(sent.back().find(":OSError") != std::string::npos, "%s", sent.back().c_str());
  CHECK(std::set<std::string>(sent.begin(), sent.end()).size() <= 4, "rebuilt at most once a minute");
}

static void test_health_uptime_counts_from_this_run_and_names_the_last_crash() {
  Rig r({"ok"}, false, false, 3600000, "SW_RESET", "Panic");
  r.board->connect();
  r.run_for(70000);
  std::string sent;
  for (const std::string &h : r.server.health)
    if (!h.empty()) sent = h;
  long uptime = atol(sent.substr(sent.find("&hu=") + 4).c_str());
  CHECK(uptime < 120, "%ld", uptime);
  CHECK(sent.find("&hs=SW_RESET") != std::string::npos, "%s", sent.c_str());
  CHECK(sent.find("&hc=Panic") != std::string::npos, "%s", sent.c_str());
}

static void test_live_games_update_faster() {
  Rig r;
  r.board->connect();
  r.run_for(60000);
  CHECK(r.board->update_job.interval_ms == app::UPDATE_EVERY, "transit");
  r.server.screen = "baseball";
  r.server.v = 2;
  r.run_for(20000);
  long long start = r.clock.t;
  r.run_for(120000);
  std::vector<long long> u;
  for (const Call &c : r.server.calls)
    if (c.name == "update" && c.ms >= start) u.push_back(c.ms);
  CHECK(u.size() >= 9, "%zu", u.size());
  CHECK(max_gap(u) <= 15000, "%lld", max_gap(u));
}

static void test_buttons_override_until_the_phone_changes_something() {
  Rig r({"ok"}, true);
  r.board->connect();
  r.run_for(5000);
  auto press = [&](bool down) {
    (down ? r.btn.held_down : r.btn.held_up) = true;
    r.run_for(200);
    (down ? r.btn.held_down : r.btn.held_up) = false;
    r.run_for(200);
  };
  press(true);
  CHECK(r.board->player.screen == "ticker", "%s", r.board->player.screen.c_str());
  r.run_for(70000);  // several updates, same version
  CHECK(r.board->player.screen == "ticker", "%s", r.board->player.screen.c_str());
  press(false);
  CHECK(r.board->player.screen == "transit", "%s", r.board->player.screen.c_str());
  press(false);
  CHECK(r.board->player.screen == "baseball", "UP wraps around: %s", r.board->player.screen.c_str());
  r.server.v = 5;  // a phone change: the board follows the server again
  r.run_for(30000);
  CHECK(r.board->player.screen == "transit", "%s", r.board->player.screen.c_str());
}

static void test_status_screens_and_retry() {
  Rig r({"nowifi", "portal", "ok"});
  r.board->connect();
  std::vector<std::string> s;
  for (const std::string &k : r.statuses)
    if (k != "connecting") s.push_back(k);
  CHECK(s == std::vector<std::string>({"nowifi", "portal", "ok"}), "%zu", s.size());
  CHECK(r.server.calls.back().name == "update-boot", "");
}

static void test_first_retries_come_quickly() {
  Rig r({"nowifi", "nowifi", "nowifi", "nowifi", "ok"});
  long long start = r.clock.t;
  r.board->connect();
  // 10 + 20 + 30 + 60 s of waiting, plus 6 s of simulated joins per round.
  CHECK(r.clock.t - start < 160000, "%lld", r.clock.t - start);
  CHECK(r.clock.t - start > 120000, "%lld", r.clock.t - start);
}

static void test_reconnects_after_repeated_failures() {
  Rig r;
  r.board->connect();
  r.run_for(20000);
  size_t n = r.statuses.size();
  r.server.fail_next = 3;
  r.run_for(60000);
  CHECK(std::find(r.statuses.begin() + n, r.statuses.end(), "connecting") != r.statuses.end(), "");
  CHECK(r.server.count("update-boot") == 1, "only the real boot resets overrides");
  CHECK(r.board->player.has_p, "");
}

static void test_line_alerts_dont_blink() {
  Rig r;
  r.server.alert = 1;
  r.board->connect();
  r.run_for(40000);
  CHECK(!r.board->player.blinking(), "");
}

static void test_fetches_start_as_the_alert_blink_turns_on() {
  Rig r;
  r.server.tornado = 1;
  r.board->connect();
  r.run_for(5 * 60 * 1000);
  int fetches = 0, off_beat = 0;
  for (size_t i = 1; i < r.server.calls.size(); i++) {
    const Call &c = r.server.calls[i];
    if (!c.has_state) continue;
    fetches++;
    if (!(c.phase >= 1000 && c.phase < 1200)) off_beat++;
  }
  CHECK(fetches > 30, "%d", fetches);
  CHECK(off_beat <= r.board->stats.forced, "%d off beat, %ld forced", off_beat, r.board->stats.forced);
  CHECK(r.board->stats.forced <= 2, "%ld", r.board->stats.forced);
  CHECK(max_gap(r.server.times("update")) <= 62000, "");
}

static void test_blink_restarts_off_after_a_fetch() {
  Rig r;
  r.server.tornado = 1;
  r.board->connect();
  r.run_for(40000);
  player::Player &p = r.board->player;
  CHECK(p.blinking(), "");
  double ended = p.blink_shift;
  CHECK(!p.blink_on(ended + 10), "");
  CHECK(p.blink_on(ended + 1010), "");
}

static void test_time_follows_the_server() {
  Rig r;
  r.board->connect();
  r.run_for(45000);
  CHECK(fabs(r.board->now(r.clock.t) - r.server.now()) <= 2, "");
}

static void test_syncs_never_set_the_clock_back_while_it_is_right() {
  Rig r;
  const long long lat[] = {400, 2600, 900, 1800, 300, 3100, 1200};
  int n = 0;
  r.server.latency = [&] { return lat[++n % 7]; };
  r.board->connect();
  long long last = r.board->now_ms(r.clock.t);
  bool back = false, far = false;
  for (int i = 0; i < 5 * 60 * 1000 / 5; i++) {
    r.board->step();
    long long t = r.board->now_ms(r.clock.t);
    if (t < last) back = true;
    if (fabs(t - r.server.now() * 1000) >= 3500) far = true;
    last = t;
    r.clock.sleep_ms(5);
  }
  CHECK(!back, "the clock went back");
  CHECK(!far, "the clock drifted");
}

static void test_a_drifting_clock_is_pulled_back_in() {
  Rig r;
  r.board->connect();
  r.board->epoch_ms += 20000;  // 20 s fast
  r.run_for(15000);
  CHECK(fabs(r.board->now_ms(r.clock.t) - r.server.now() * 1000) < 3000, "");
  r.board->epoch_ms -= 40000;  // 20 s slow
  r.run_for(15000);
  CHECK(fabs(r.board->now_ms(r.clock.t) - r.server.now() * 1000) < 3000, "");
}

static void test_idle_screens_redraw_only_when_something_changes() {
  Rig r;
  r.board->connect();
  r.run_for(5000);
  long start = r.display.frames;
  r.run_for(5 * 60 * 1000);
  double per_s = (r.display.frames - start) / 300.0;
  CHECK(per_s < 2 && per_s > 0.9, "%f per s", per_s);
}

static void test_auto_visits_the_radar_on_a_timer_and_prefetches_frames() {
  Rig r;
  r.server.radar_on = true;
  r.server.visit = "{\"every\":240,\"for\":60}";
  r.board->connect();
  int wrong = 0;
  for (int i = 0; i < 10 * 60 * 1000 / 50; i++) {
    r.board->step();
    long long phase = draw::fmod_floor(r.board->now(r.clock.t), 240);
    const std::string &s = r.board->player.screen;
    if (phase >= 3 && phase < 57 && s != "weather") wrong++;
    if (phase >= 63 && phase < 237 && s != "transit") wrong++;
    r.clock.sleep_ms(50);
  }
  CHECK(wrong == 0, "%d", wrong);
  CHECK(r.board->player.missing_frames().empty(), "fetched before the visit");
}

static void test_buttons_beat_the_timer() {
  Rig r({"ok"}, true);
  r.server.radar_on = true;
  r.server.visit = "{\"every\":240,\"for\":60}";
  r.board->connect();
  r.run_for(2000);
  r.btn.held_down = true;
  r.run_for(2500);
  r.btn.held_down = false;
  std::string pressed = r.board->player.screen;
  CHECK(r.board->override_.screen.has_value(), "");
  r.run_for(200000);
  CHECK(r.board->player.screen == pressed, "%s", r.board->player.screen.c_str());
}

static void test_no_visits_without_rain_or_when_off() {
  Rig r;
  r.server.radar_on = false;
  r.server.visit = "{\"every\":240,\"for\":60}";
  r.board->connect();
  r.run_for(5 * 60 * 1000);
  CHECK(r.board->player.screen == "transit", "");
  CHECK(r.server.count("radar") == 0, "");
}

static void test_quiet_until_the_next_minute_boundary() {
  long long now = T0;
  Value p = parse("{\"now\":" + jnum(now) + ",\"tzo\":0,\"header\":null,\"view\":\"dest\",\"wx\":null,"
                  "\"rows\":[{\"ln\":\"RD\",\"lbl\":\"HOWARD\",\"t\":[" + jnum(now + 125) + "],\"s\":[0],\"a\":0}]}");
  // 125 s out shows 3; it becomes 2 at 120 s out, i.e. in 5 s.
  CHECK(player::transit_quiet_ms(p, now) == 5000, "%f", player::transit_quiet_ms(p, now));
  // At DUE (40 s out), the next change is the drop 30 s after arrival.
  CHECK(player::transit_quiet_ms(p, now + 85) == 70000, "%f", player::transit_quiet_ms(p, now + 85));
}

static void test_the_cached_quiet_time_matches_a_fresh_one_every_second() {
  long long now = T0;
  std::string rows = "[{\"ln\":\"RD\",\"lbl\":\"HOWARD\",\"t\":[" + jnum(now + 125) + "," + jnum(now + 400) + "," +
                     jnum(now + 700) + "],\"s\":[0,0,1],\"a\":0},{\"ln\":\"RD\",\"lbl\":\"95TH\",\"t\":[" +
                     jnum(now + 15) + "," + jnum(now + 290) + "],\"s\":[0,0],\"a\":0},{\"ln\":\"PR\",\"lbl\":\"LINDEN\",\"t\":[" +
                     jnum(now + 61) + "],\"s\":[1],\"a\":0}]";
  for (const char *view : {"dest", "chrono"}) {
    player::Player pl;
    pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"tzo\":0,\"header\":null,\"view\":\"" + view +
                         "\",\"wx\":null,\"rows\":" + rows + "}"),
                   0);
    int bad = 0;
    for (int s = 0; s < 800; s++)
      if (pl.quiet_ms(0, now + s) != player::transit_quiet_ms(pl.p, now + s)) bad++;
    CHECK(bad == 0, "%s: %d", view, bad);
    CHECK(pl.quiet_ms(0, now + 800) == player::FAR, "every train gone");
  }
}

static void test_led_blue_during_each_request_and_off_between() {
  Rig r({"ok"}, false, true);
  SimLed *led = &r.led;
  std::vector<std::string> during;
  auto real = r.server.latency;
  r.server.latency = [&, real] {
    during.push_back(led->state);
    return real();
  };
  r.board->connect();
  CHECK(led->state == "off", "%s", led->state.c_str());
  size_t n = during.size();
  r.run_for(60000);
  CHECK(during.size() > n, "");
  bool all_fetch = true;
  for (size_t i = n; i < during.size(); i++)
    if (during[i] != "fetch") all_fetch = false;
  CHECK(all_fetch, "");
  CHECK(led->state == "off", "%s", led->state.c_str());
}

static void test_led_connecting_portal_and_offline() {
  Rig r({"nowifi", "portal", "ok"}, false, true);
  r.board->connect();
  CHECK(r.led.log == std::vector<std::string>({"connecting", "offline", "connecting", "portal", "connecting", "off"}),
        "%zu", r.led.log.size());
}

static void test_led_dim_red_after_a_failure_until_a_request_succeeds() {
  Rig r({"ok"}, false, true);
  r.board->connect();
  r.run_for(20000);
  r.server.fail_next = 1;
  size_t n = r.led.log.size();
  r.run_for(30000);
  std::vector<std::string> names;
  for (size_t i = n; i < r.led.log.size(); i++)
    if (r.led.log[i] != "fetch") names.push_back(r.led.log[i]);
  CHECK(names.size() >= 2 && names[0] == "failing" && names[1] == "off", "");
  CHECK(r.led.state == "off", "");
}

static void test_led_red_while_reconnecting_after_repeated_failures() {
  Rig r({"ok"}, false, true);
  r.board->connect();
  r.run_for(20000);
  r.server.fail_next = 3;
  size_t n = r.led.log.size();
  r.run_for(60000);
  std::vector<std::string> names(r.led.log.begin() + n, r.led.log.end());
  CHECK(std::find(names.begin(), names.end(), "failing") != names.end(), "");
  CHECK(std::find(names.begin(), names.end(), "connecting") != names.end(), "");
  CHECK(r.led.state == "off", "");
}

static void test_brightness_in_hardware_or_in_the_colors() {
  // A display that dims in hardware gets the payload's brightness and full
  // brightness frames; one that doesn't gets frames scaled by the renderer.
  int max_hw = 0, max_sw = 0;
  for (bool hw : {true, false}) {
    Rig r;
    r.display.hw = hw;
    r.server.bright = 40;
    r.board->connect();
    r.run_for(5000);
    CHECK(r.display.k == 0.4, "%f", r.display.k);
    CHECK(r.board->player.hw_bright == hw, "");
    (hw ? max_hw : max_sw) = r.display.max_px;
  }
  CHECK(max_hw == 0xd8 || max_hw == 0xff || max_hw > 200, "full-brightness frame: %d", max_hw);
  CHECK(max_sw <= (int)(255 * 0.4 + 1), "scaled frame: %d", max_sw);
}

int main() {
  struct T {
    const char *name;
    void (*fn)();
  } tests[] = {
#define T_(f) {#f, f}
      T_(test_a_held_train_stays_due_until_the_server_drops_it),
      T_(test_fetches_land_in_gaps_and_data_stays_fresh),
      T_(test_settings_change_shows_up_fast),
      T_(test_radar_frames_only_on_the_radar_screen_and_once_each),
      T_(test_radar_frames_stay_current_over_many_loops),
      T_(test_radar_loop_fills_in_back_to_back),
      T_(test_logos_only_on_the_baseball_screen_and_once_each),
      T_(test_logos_hold_the_current_and_next_game),
      T_(test_a_button_press_fetches_the_new_screens_sections_right_away),
      T_(test_health_rides_on_the_version_check_once_a_minute),
      T_(test_health_uptime_counts_from_this_run_and_names_the_last_crash),
      T_(test_live_games_update_faster),
      T_(test_buttons_override_until_the_phone_changes_something),
      T_(test_status_screens_and_retry),
      T_(test_first_retries_come_quickly),
      T_(test_reconnects_after_repeated_failures),
      T_(test_line_alerts_dont_blink),
      T_(test_fetches_start_as_the_alert_blink_turns_on),
      T_(test_blink_restarts_off_after_a_fetch),
      T_(test_time_follows_the_server),
      T_(test_syncs_never_set_the_clock_back_while_it_is_right),
      T_(test_a_drifting_clock_is_pulled_back_in),
      T_(test_idle_screens_redraw_only_when_something_changes),
      T_(test_auto_visits_the_radar_on_a_timer_and_prefetches_frames),
      T_(test_buttons_beat_the_timer),
      T_(test_no_visits_without_rain_or_when_off),
      T_(test_quiet_until_the_next_minute_boundary),
      T_(test_the_cached_quiet_time_matches_a_fresh_one_every_second),
      T_(test_led_blue_during_each_request_and_off_between),
      T_(test_led_connecting_portal_and_offline),
      T_(test_led_dim_red_after_a_failure_until_a_request_succeeds),
      T_(test_led_red_while_reconnecting_after_repeated_failures),
      T_(test_brightness_in_hardware_or_in_the_colors),
#undef T_
  };
  int n = 0;
  for (const T &t : tests) {
    g_test = t.name;
    int before = g_failed;
    t.fn();
    if (g_failed == before) n++;
    else printf("  in %s\n", t.name);
  }
  printf("%d of %zu tests passed (%d checks, %d failed)\n", n, sizeof tests / sizeof tests[0], g_checks, g_failed);
  return g_failed ? 1 : 0;
}
