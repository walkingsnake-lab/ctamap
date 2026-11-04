// The board's main loop (src/app.cpp) against a simulated server, clock,
// display, and buttons: the C++ twin of firmware/tests/test_app.py, with the
// same scenarios. Requests take simulated time on a simulated worker, so
// these check the scheduling the board depends on: animations never wait
// for a request, data stays fresh, settings changes show up fast, radar frames and logos are
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
#include "../ctaboard/src/color.h"
#include "../ctaboard/src/draw.h"
#include "../ctaboard/src/json.h"
#include "../ctaboard/src/player.h"

using json::Value;

static const long long T0 = 1791140000;  // epoch seconds at the start of each simulation
static const long long LATENCY = 1500;   // ms per request
static const long long UPDATE_GAP_MAX = 30000 + 2 * LATENCY + 1000;  // with the worker: the interval, plus a request waiting for the one out

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
  bool busy = false;  // an animation was running when it went out
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
  size_t joins_on = 0;  // which saved network an "ok" joins
  std::string visit = "null";
  int alert = 0;
  int tornado = 0;
  std::string layout = "classic";
  int bright = 100;
  std::string ab = "null";  // auto brightness range (light sensor), raw JSON
  std::function<long long()> latency = [] { return LATENCY; };
  std::function<std::string(long long)> rows_fn;  // JSON array of rows
  bool knob_ring = true;                          // send the knob's ring (payload `knob`)
  std::vector<std::string> selects;               // categories the knob chose
  // Peek chooser (contract "Peek"): the ring with variants, and pv. The
  // variants the knob chose (empty: none), and each category's current one.
  bool peek = false;
  std::vector<std::string> variants;
  std::string tscreen = "transit", wx_view = "now", face = "skyline";
  std::string fw;                                 // version check's `fw` offer (JSON object), "" for none
  long long wipe = 0;                             // version check's `wipe` stamp (a new owner), 0 for none
  int fw_fail = 0;                                // fail the next firmware downloads halfway
  std::string cloud = "p1";                       // the skyline's cloud strip id, "" for a clear sky
  std::string msg = "null";                       // the announce screen's message (payload `msg`), raw JSON

  bool deferred = false;  // on the SimWorker: requests take time without moving the loop's clock
  long long owed = 0;     // simulated time the deferred requests took

  explicit Server(SimClock *c) : clock(c) {}

  double now() const { return T0 + clock->t / 1000.0; }

  bool call(const std::string &name, std::string &err) {
    Call rec{name, clock->t};
    if (board && board->player.has_p) {
      long long ms = clock->t;
      rec.busy = board->player.busy((double)ms);
    }
    calls.push_back(rec);
    if (deferred) owed += latency();
    else clock->t += latency();
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
    int at = screen == "transit" || screen == "ticker" ? 1 : screen == "weather" ? 2 : screen == "baseball" ? 3 : 0;
    std::string knob = knob_ring ? ",\"knob\":{\"ring\":[\"auto\",\"transit\",\"weather\",\"sports\"],\"at\":" + jnum(at) + "}" : "";
    std::string pv;
    if (peek) {
      // Ring transit, weather, clock, announce, cycle; every section and pv.
      auto idx = [](const std::vector<std::string> &l, const std::string &s) {
        for (size_t i = 0; i < l.size(); i++)
          if (l[i] == s) return (int)i;
        return 0;
      };
      int pat = screen == "transit" || screen == "ticker" ? 0 : screen == "weather" ? 1 : screen == "clock" ? 2 : screen == "announce" ? 3 : 4;
      knob = ",\"knob\":{\"ring\":[\"transit\",\"weather\",\"clock\",\"announce\",\"cycle\"],\"at\":" + jnum(pat) +
             ",\"vars\":[[\"transit\",\"ticker\"],[\"now\",\"5day\",\"hourly\",\"radar\"],[\"skyline\",\"seventies\",\"analog\"],[],[]],\"sel\":[" +
             jnum(idx({"transit", "ticker"}, tscreen)) + "," + jnum(idx({"now", "5day", "hourly", "radar"}, wx_view)) + "," +
             jnum(idx({"skyline", "seventies", "analog"}, face)) + ",0,0],\"ln\":\"RD\"}";
      std::string pf = "[", pft = "[";
      for (int k = 2; k >= 0; k--) {
        pf += std::string(pf.size() > 1 ? "," : "") + "\"40100-" + jnum(now / 360 * 360 - k * 360) + "\"";
        pft += std::string(pft.size() > 1 ? "," : "") + jnum(now / 360 * 360 - k * 360);
      }
      pv = ",\"cface\":\"" + face + "\",\"pv\":{\"days\":[{\"d\":\"SU\",\"hi\":60,\"icon\":\"sun\"}],\"hours\":[{\"h\":\"1P\",\"t\":50,\"icon\":\"sun\"}],"
           "\"skyline\":" + skyline(true) + ",\"cwx\":{\"temp\":60,\"icon\":\"sun\"},\"radar\":{\"frames\":" + pf + "],\"ft\":" + pft + "]}}";
    }
    return "{\"v\":" + jnum(v) + ",\"now\":" + jnum(now) + ",\"tzo\":-18000,\"age\":3,\"screen\":\"" + scr +
           "\",\"bright\":" + jnum(bright) + ",\"ab\":" + ab + ",\"header\":\"MORSE\",\"view\":\"dest\",\"rows\":" + rows + ",\"ticker\":" + ticker +
           ",\"wx\":" + (tornado ? "{\"icon\":\"storm\",\"temp\":70,\"word\":\"STORMS\"}" : "null") +
           ",\"warn\":" + (tornado ? "{\"kind\":\"tor\",\"lvl\":\"warning\"}" : "null") +
           ",\"radar\":{\"on\":" + (radar_on ? "true" : "false") + ",\"visit\":" + visit + ",\"frames\":" + frames +
           ",\"ft\":" + ft + ",\"timeBox\":[40,0,24,22],\"split\":false},\"mlb\":{\"layout\":\"" + layout +
           "\",\"games\":" + game_list + "}" + knob + skyline() + pv + ",\"msg\":" + msg + "}";
  }

  app::ConnectResult connect(const app::Networks &networks, const app::StatusFn &status) override {
    for (const auto &n : networks) {
      status("connecting", n.first);
      clock->t += 3000;
    }
    std::string result = wifi.size() > 1 ? wifi.front() : wifi[0];
    if (wifi.size() > 1) wifi.erase(wifi.begin());
    if (result == "ok") return {"ok", networks[std::min(joins_on, networks.size() - 1)].first};
    return {result, result == "portal" ? "aa:bb:cc:dd:ee:ff" : ""};
  }

  bool version(const std::string &h, Value &out, std::string &err) override {
    if (!call("version", err)) return false;
    health.push_back(h);
    out = parse("{\"v\":" + jnum(v) + ",\"now\":" + jnum((long long)floor(now())) + (fw.empty() ? "" : ",\"fw\":" + fw) +
                (wipe ? ",\"wipe\":" + jnum(wipe) : "") + "}");
    return true;
  }

  bool firmware(const std::string &ver, long long size, const app::ChunkFn &chunk, std::string &err) override {
    if (!call("firmware:" + ver, err)) return false;
    std::vector<uint8_t> buf(4096, 0xab);
    for (long long got = 0; got < size;) {
      if (fw_fail && got >= size / 2) {
        fw_fail--;
        err = "Short";
        return false;
      }
      size_t n = (size_t)std::min<long long>(4096, size - got);
      clock->t += 50;  // download time
      if (!chunk(buf.data(), n)) return false;
      got += (long long)n;
    }
    return true;
  }

  bool update(bool boot, const std::string &scr, Value &out, std::string &err) override {
    if (!call(boot ? "update-boot" : "update", err)) return false;
    update_screens.push_back(scr);
    out = parse(payload());
    return true;
  }

  bool select(const std::string &cat, const std::string &var, Value &out, std::string &err) override {
    if (!call("select:" + cat, err)) return false;
    selects.push_back(cat);
    variants.push_back(var);
    if (cat == "transit" && !var.empty()) tscreen = var;
    if (cat == "weather" && !var.empty()) wx_view = var;
    if (cat == "clock" && !var.empty()) face = var;
    screen = cat == "sports" ? "baseball" : cat == "auto" || cat == "cycle" ? "transit" : cat == "transit" ? tscreen : cat;
    v++;
    out = parse(payload());
    return true;
  }

  // The clock screen's skyline section (contract "Skyline"), with a cloud
  // strip unless `cloud` is empty.
  std::string skyline(bool any = false) const {
    if (screen != "clock" && !any) return "";
    std::string cl = cloud.empty() ? "null" : "{\"id\":\"" + cloud + "\",\"pal\":[\"\",\"#eef2f8\",\"#eef2f8\"],\"a\":[0,35,70]}";
    return std::string(any ? "" : ",\"skyline\":") + "{\"face\":\"skyline\",\"st\":\"partly\",\"sky\":[[0,\"#08245a\"],[25,\"#3a6eb0\"]],"
           "\"wat\":[\"#0a2a52\",\"#06203f\",\"#1a3a68\"],\"lit\":0,\"win\":0,\"stars\":0,\"sun\":{\"x\":41,\"y\":5,\"c\":\"#ffd040\"},"
           "\"moon\":null,\"gl\":{\"x\":41,\"c\":\"#c8d8f0\",\"p\":0},\"whl\":0,\"fog\":null,\"roof\":null,\"pcp\":null,"
           "\"storm\":0,\"boats\":1,\"temp\":61,\"cl\":" + cl + "}";
  }

  bool sky(const std::string &id, std::vector<uint8_t> &out, std::string &err) override {
    if (!call("sky:" + id, err)) return false;
    out.assign(1664, 0x12);
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
  std::vector<std::pair<long long, double>> ks;  // every brightness set, with the time
  int max_px = 0;    // brightest channel in the last frame
  draw::Frame last;  // the last frame shown
  explicit SimDisplay(SimClock *c) : clock(c) {}
  void show(const std::function<void(draw::Frame &)> &fn) override {
    draw::Frame f;
    fn(f);
    last = f;
    frames++;
    max_px = 0;
    for (uint8_t v : f.px) max_px = std::max(max_px, (int)v);
    clock->t += 20;  // render cost
  }
  double set_brightness(double kk) override {
    k = kk;
    ks.push_back({clock->t, kk});
    return hw ? color::hw_dim(kk).share : kk;
  }
};

struct SimLight : app::Light {
  double lux = 1;
  bool ok = true;
  int reads = 0;
  bool read(double &out) override {
    reads++;
    if (!ok) return false;
    out = lux;
    return true;
  }
};

// The S3's network worker: the request "runs" when it starts (on this
// thread) but takes its latency in simulated time while the loop keeps
// stepping; done() turns true once that time has passed.
struct SimWorker : app::Worker {
  Server *server;
  SimClock *clock;
  long long ready = -1;
  bool hang = false;  // never finishes
  int started = 0;
  SimWorker(Server *s, SimClock *c) : server(s), clock(c) {}
  void start(std::function<void()> work) override {
    started++;
    server->deferred = true;
    server->owed = 0;
    work();
    server->deferred = false;
    ready = clock->t + server->owed;
  }
  bool done() override { return !hang && clock->t >= ready; }
};

struct SimWatchdog : app::Watchdog {
  SimClock *clock;
  long long last = 0;
  explicit SimWatchdog(SimClock *c) : clock(c) {}
  void feed() override { last = clock->t; }
};


struct SimButtons : app::Buttons {
  bool held_up = false, held_down = false;
  bool up() override { return held_up; }
  bool down() override { return held_down; }
};

struct SimKnob : app::Knob {
  int pending = 0;
  bool down = false;
  bool pressed() override { return down; }
  int clicks() override {
    int c = pending;
    pending = 0;
    return c;
  }
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

// OTA slot: what was written, and the trial state the board would keep in flash.
struct SimOta : app::Ota {
  std::string trial_, bad_;
  long long size = 0, written = 0;
  int begun = 0, finished = 0, aborted = 0, restarts = 0, kept = 0, rollbacks = 0;
  bool fail_finish = false, key = true;
  std::string rolled_why, sig;
  bool begin(long long sz, std::string &) override {
    begun++;
    size = sz;
    written = 0;
    return true;
  }
  bool write(const uint8_t *, size_t n) override {
    written += (long long)n;
    return true;
  }
  bool finish(const app::FirmwareOffer &o, std::string &err) override {
    if (fail_finish || written != size) {
      err = "SHA";
      return false;
    }
    finished++;
    sig = o.sig;
    trial_ = o.v;
    return true;
  }
  void abort() override { aborted++; }
  void restart() override { restarts++; }
  std::string trial() override { return trial_; }
  bool can_verify() override { return key; }
  std::string bad() override { return bad_; }
  void keep() override {
    kept++;
    trial_.clear();
  }
  void roll_back(const std::string &why) override {
    rollbacks++;
    rolled_why = why;
    bad_ = ota::mark(trial_, 0);
    trial_.clear();
  }
};

// The setup network: records each opening; "the user" then fixes WiFi.
struct SimSetup : app::Setup {
  Server *server = nullptr;
  std::vector<std::string> runs;
  int joins = 0;
  long long at = -1;
  SimClock *clock = nullptr;
  void run(const std::string &why) override {
    runs.push_back(why);
    at = clock->t;
    server->wifi = {"ok"};
  }
  void joined() override { joins++; }
};

struct Rig {
  SimClock clock;
  Server server{&clock};
  SimDisplay display{&clock};
  SimButtons btn;
  SimKnob knob;
  SimLed led{&clock};
  std::vector<std::string> statuses;
  std::vector<std::string> led_during;  // LED state during each request
  SimWorker worker{&server, &clock};
  std::unique_ptr<app::Board> board;

  explicit Rig(std::vector<std::string> wifi = {"ok"}, bool buttons = false, bool with_led = false,
               long long start_ms = 0, std::string started = "", std::string crash = "", bool with_knob = false) {
    clock.t = start_ms;
    server.wifi = wifi;
    board.reset(new app::Board(&server, &display, &clock, {{"home", "pw"}, {"phone", "pw"}}, buttons ? &btn : nullptr,
                               nullptr, nullptr, started, crash, with_led ? &led : nullptr, with_knob ? &knob : nullptr));
    server.board = board.get();
    board->worker = &worker;
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

// The screen on show, by name.
static std::string S(const std::unique_ptr<app::Board> &b) { return screen::name(b->player.screen); }

static long long max_gap(const std::vector<long long> &t) {
  long long g = 0;
  for (size_t i = 1; i < t.size(); i++) g = std::max(g, t[i] - t[i - 1]);
  return g;
}

// ---- tests ----

static const char *OFFER = "{\"v\":\"bbbbbbb\",\"size\":300000,\"sha\":\"00\",\"n\":0,\"sig\":\"3045\"}";

static std::string last_health(const Rig &r) {
  std::string sent;
  for (const std::string &h : r.server.health)
    if (!h.empty()) sent = h;
  return sent;
}

static void test_setup_opens_right_away_with_no_networks() {
  // run() restarts the board; here "the user" saves a network and it returns.
  Rig r;
  r.board->networks.clear();
  struct OneShot : app::Setup {
    app::Board *b;
    std::vector<std::string> runs;
    void run(const std::string &why) override { runs.push_back(why); b->networks = {{"home", "pw"}}; }
  } os;
  os.b = r.board.get();
  r.board->setup = &os;
  r.board->connect();
  CHECK(os.runs.size() == 1 && os.runs[0] == "nowifi", "%zu", os.runs.size());
  CHECK(r.board->online, "");
}

static void test_setup_opens_after_ten_minutes_without_wifi() {
  std::vector<std::string> wifi(40, "nowifi");
  Rig r(wifi);
  SimSetup su;
  su.server = &r.server;
  su.clock = &r.clock;
  r.board->setup = &su;
  r.board->connect();
  CHECK(su.runs.size() == 1 && su.runs[0] == "nowifi", "%zu", su.runs.size());
  CHECK(su.at >= app::SETUP_AFTER_MS && su.at < app::SETUP_AFTER_MS + 120000, "%lld", su.at);
  CHECK(su.joins == 0, "not a new network");
}

static void test_setup_never_opens_while_the_server_is_down() {
  std::vector<std::string> wifi(60, "ok");
  Rig r(wifi);
  SimSetup su;
  su.server = &r.server;
  su.clock = &r.clock;
  r.board->setup = &su;
  r.server.fail_next = 40;  // WiFi joins, every update fails
  r.board->connect();
  CHECK(su.runs.empty(), "%zu", su.runs.size());
  CHECK(r.clock.t > app::SETUP_AFTER_MS, "%lld", r.clock.t);
}

static void test_setup_reopens_when_the_new_network_fails_and_clears_after_a_join() {
  Rig r({"nowifi", "ok"});
  SimSetup su;
  su.server = &r.server;
  su.clock = &r.clock;
  r.board->setup = &su;
  r.board->fresh_wifi = true;
  r.board->connect();
  CHECK(su.runs.size() == 1 && su.runs[0] == "badwifi", "%zu", su.runs.size());
  CHECK(su.joins == 0 && !r.board->fresh_wifi, "");
  Rig r2;
  SimSetup su2;
  su2.server = &r2.server;
  su2.clock = &r2.clock;
  r2.board->setup = &su2;
  r2.board->fresh_wifi = true;
  r2.board->connect();
  CHECK(su2.runs.empty() && su2.joins == 1, "%zu %d", su2.runs.size(), su2.joins);
  // An older saved network joined instead: the new one isn't marked as working.
  Rig r3;
  SimSetup su3;
  su3.server = &r3.server;
  su3.clock = &r3.clock;
  r3.board->setup = &su3;
  r3.board->fresh_wifi = true;
  r3.server.joins_on = 1;
  r3.board->connect();
  CHECK(r3.board->online && su3.joins == 0 && su3.runs.empty() && !r3.board->fresh_wifi, "%d", su3.joins);
}

static void test_a_new_owner_wipe_forgets_wifi_once_per_stamp() {
  // The server's `wipe` stamp (a transfer): forget(stamp) once; the same
  // stamp again does nothing, a newer one forgets again. The applied stamp
  // rides on the health report (hz).
  struct Wipes : app::Setup {
    std::vector<long long> forgot;
    long long applied = 0;
    int checkins = 0;
    void run(const std::string &) override {}
    void forget(long long stamp) override { forgot.push_back(stamp); applied = stamp; }
    long long wiped() override { return applied; }
    void checked_in() override { checkins++; }
  } su;
  Rig r;
  r.board->setup = &su;
  r.board->connect();
  r.run_for(30000);
  CHECK(su.forgot.empty(), "no stamp, no wipe");
  CHECK(su.checkins > 0, "each check-in without a newer stamp says so (a just-entered network stops being new)");
  int before = su.checkins;
  r.server.wipe = 1793400000;
  r.run_for(30000);
  CHECK(su.forgot.size() == 1 && su.forgot[0] == 1793400000, "%zu", su.forgot.size());
  CHECK(su.checkins - before <= 3, "not while a newer stamp waits");
  r.run_for(90000);
  CHECK(su.forgot.size() == 1, "the same stamp again: nothing (%zu)", su.forgot.size());
  CHECK(last_health(r).find("&hz=1793400000") != std::string::npos, "%s", last_health(r).c_str());
  r.server.wipe = 1793400100;
  r.run_for(30000);
  CHECK(su.forgot.size() == 2 && su.forgot[1] == 1793400100, "%zu", su.forgot.size());
  // Without a setup network (no Setup), the stamp is ignored.
  Rig r2;
  r2.server.wipe = 1793400000;
  r2.board->connect();
  r2.run_for(30000);
  CHECK(r2.board->online, "");
}

static void test_ota_installs_an_offered_build_between_animations() {
  Rig r;
  SimOta o;
  r.board->ota = &o;
  r.board->firmware = "aaaaaaa";
  r.board->connect();
  r.server.fw = OFFER;
  r.run_for(60000);
  CHECK(o.begun == 1, "%d", o.begun);
  CHECK(o.written == 300000, "%lld", o.written);
  CHECK(o.finished == 1 && o.restarts == 1, "%d %d", o.finished, o.restarts);
  CHECK(r.server.count("firmware:bbbbbbb") == 1, "");
  bool updating = false;
  for (const std::string &st : r.statuses) updating = updating || st == "updating";
  CHECK(updating, "shows UPDATING");
  for (const Call &c : r.server.calls)
    if (c.name.compare(0, 9, "firmware:") == 0) CHECK(!c.busy, "installs between animations");
}

static void test_ota_passes_the_signature_and_ignores_unsigned_offers() {
  Rig r;
  SimOta o;
  r.board->ota = &o;
  r.board->firmware = "aaaaaaa";
  r.board->connect();
  r.server.fw = "{\"v\":\"bbbbbbb\",\"size\":300000,\"sha\":\"00\",\"n\":0}";  // no sig
  r.run_for(130000);
  CHECK(o.begun == 0 && r.server.count("firmware:") == 0, "unsigned: not downloaded");
  CHECK(last_health(r).find("&hx=unsigned:bbbbbbb") != std::string::npos, "%s", last_health(r).c_str());
  r.server.fw = OFFER;
  r.run_for(60000);
  CHECK(o.finished == 1 && o.sig == "3045", "the signature reaches the slot's check: %s", o.sig.c_str());
  // A build without a signing key installs nothing, and says so.
  Rig r2;
  SimOta o2;
  o2.key = false;
  r2.board->ota = &o2;
  r2.board->firmware = "aaaaaaa";
  r2.board->connect();
  r2.server.fw = OFFER;
  r2.run_for(130000);
  CHECK(o2.begun == 0, "");
  CHECK(last_health(r2).find("&hx=nokey:bbbbbbb") != std::string::npos, "%s", last_health(r2).c_str());
  // Hex signatures to bytes.
  std::vector<uint8_t> b;
  CHECK(ota::from_hex("3045aB", b) && b.size() == 3 && b[0] == 0x30 && b[2] == 0xab, "");
  CHECK(!ota::from_hex("304", b) && !ota::from_hex("zz", b), "");
}

static void test_ota_leaves_the_running_build_alone() {
  Rig r;
  SimOta o;
  r.board->ota = &o;
  r.board->firmware = "bbbbbbb";
  r.board->connect();
  r.server.fw = OFFER;  // the build it already runs
  r.run_for(60000);
  CHECK(o.begun == 0 && r.server.count("firmware:") == 0, "");
  Rig r2;
  SimOta o2;
  r2.board->ota = &o2;
  r2.board->firmware = "aaaaaaa";
  r2.board->connect();  // no offer
  r2.run_for(60000);
  CHECK(o2.begun == 0, "");
}

static void test_ota_failed_download_carries_on_and_retries_later() {
  Rig r;
  SimOta o;
  r.board->ota = &o;
  r.board->firmware = "aaaaaaa";
  r.board->connect();
  r.server.fw = OFFER;
  r.server.fw_fail = 1;
  r.run_for(5 * 60000);
  CHECK(o.begun == 1 && o.aborted == 1 && o.restarts == 0, "%d %d %d", o.begun, o.aborted, o.restarts);
  CHECK(r.server.count("update") > 5, "keeps running");
  CHECK(last_health(r).find("&hx=error:Short") != std::string::npos, "%s", last_health(r).c_str());
  CHECK(last_health(r).find("&he=firmware:Short") != std::string::npos, "%s", last_health(r).c_str());
  r.run_for(ota::RETRY_MS);
  CHECK(o.begun == 2 && o.restarts == 1, "%d %d", o.begun, o.restarts);
}

static void test_ota_trial_build_is_kept_once_it_has_reached_the_server() {
  Rig r;
  SimOta o;
  o.trial_ = "bbbbbbb";
  r.board->ota = &o;
  r.board->firmware = "bbbbbbb";
  r.board->connect();
  r.run_for(30000);
  CHECK(o.kept == 0, "not before a minute");
  CHECK(last_health(r).find("&hx=trial:bbbbbbb") != std::string::npos, "%s", last_health(r).c_str());
  r.run_for(40000);
  CHECK(o.kept == 1 && o.rollbacks == 0, "%d %d", o.kept, o.rollbacks);
}

static void test_ota_trial_build_that_cant_reach_the_server_rolls_back() {
  std::vector<std::string> wifi(12, "nowifi");
  wifi.push_back("ok");
  Rig r(wifi);
  SimOta o;
  o.trial_ = "bbbbbbb";
  r.board->ota = &o;
  r.board->firmware = "bbbbbbb";
  r.board->connect();
  CHECK(o.rollbacks == 1 && o.rolled_why == "noserver", "%d %s", o.rollbacks, o.rolled_why.c_str());
  CHECK(o.kept == 0, "");
  CHECK(o.bad_ == "bbbbbbb_0", "%s", o.bad_.c_str());
}

static void test_ota_rolled_back_offer_waits_for_try_again() {
  Rig r;
  SimOta o;
  o.bad_ = "bbbbbbb_0";
  r.board->ota = &o;
  r.board->firmware = "aaaaaaa";
  r.board->connect();
  r.server.fw = OFFER;
  r.run_for(130000);
  CHECK(o.begun == 0, "not reinstalled");
  CHECK(last_health(r).find("&hx=rolledback:bbbbbbb") != std::string::npos, "%s", last_health(r).c_str());
  r.server.fw = "{\"v\":\"bbbbbbb\",\"size\":300000,\"sha\":\"00\",\"n\":1,\"sig\":\"3045\"}";  // Try again
  r.run_for(60000);
  CHECK(o.begun == 1 && o.restarts == 1, "%d %d", o.begun, o.restarts);
}

static void test_ota_boot_counts_trial_starts() {
  ota::State s;
  s.trial = "bbbbbbb";
  CHECK(ota::on_boot(s, "bbbbbbb") == ota::RUN && s.boots == 1, "");
  CHECK(ota::on_boot(s, "bbbbbbb") == ota::RUN, "");
  CHECK(ota::on_boot(s, "bbbbbbb") == ota::RUN, "");
  CHECK(ota::on_boot(s, "bbbbbbb") == ota::ROLL_BACK, "a crash loop goes back");
  s.retry = 2;
  ota::rolled_back(s);
  CHECK(s.trial.empty() && s.bad == "bbbbbbb_2", "%s", s.bad.c_str());
  ota::State u;
  u.trial = "bbbbbbb";
  u.prev = "ota_0";
  CHECK(ota::on_boot(u, "ccccccc") == ota::RUN && u.trial.empty() && u.prev.empty(), "a USB flash ends the trial");
}

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

static void test_settings_change_shows_up_fast() {
  Rig r;
  r.board->connect();
  r.run_for(15000);
  r.server.v = 2;
  r.server.screen = "ticker";
  long long changed_at = r.clock.t;
  while (S(r.board) != "ticker" && r.clock.t - changed_at < 30000) {
    r.board->step();
    r.clock.sleep_ms(5);
  }
  CHECK(S(r.board) == "ticker", "phone change took too long");
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
  CHECK(S(r.board) == "weather", "%s", S(r.board).c_str());
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
  CHECK(S(r.board) == "baseball", "");
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
  CHECK(r.server.update_screens.back() == S(r.board), "");
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

static void test_health_names_the_hardware_and_firmware_build() {
  Rig r;
  r.board->hardware = "adafruit_matrixportal_s3";
  r.board->firmware = "a1b2c3d";
  r.board->connect();
  r.run_for(70000);
  std::string sent;
  for (const std::string &h : r.server.health)
    if (!h.empty()) sent = h;
  CHECK(sent.find("&hd=adafruit_matrixportal_s3") != std::string::npos, "%s", sent.c_str());
  CHECK(sent.find("&hv=a1b2c3d") != std::string::npos, "%s", sent.c_str());
}

static void test_health_reports_the_skyline_capability() {
  Rig r;
  r.board->connect();
  r.run_for(70000);
  std::string sent;
  for (const std::string &h : r.server.health)
    if (!h.empty()) sent = h;
  CHECK(sent.find("&hk=skyline:seventies:analog:daynight:gradient:announce") != std::string::npos, "%s", sent.c_str());
}

static void test_announce_typewriter_animates_its_intro_then_redraws_only_for_the_cursor() {
  Rig r;
  r.server.screen = "announce";
  r.server.msg = "{\"id\":5,\"style\":\"type\",\"lines\":[\"Back by 6\"]}";
  r.board->connect();
  r.run_for(300);
  CHECK(S(r.board) == "announce", "%s", S(r.board).c_str());
  // Typing (400 ms wait + 9 characters at 90 ms): a frame every pass.
  CHECK(r.board->player.busy((double)r.clock.t), "typing");
  long f0 = r.display.frames;
  r.run_for(800);
  CHECK(r.display.frames - f0 > 20, "%ld frames while typing", r.display.frames - f0);
  // Typed: still between cursor blinks (530 ms): a redraw per blink and per second (the frame key's clock).
  r.run_for(1000);
  CHECK(!r.board->player.busy((double)r.clock.t), "settled");
  long f1 = r.display.frames;
  r.run_for(5300);
  long n = r.display.frames - f1;
  CHECK(n >= 9 && n <= 17, "%ld frames in 5.3 s", n);
  // The same message on the next update doesn't retype; a new one does.
  r.server.v++;
  r.run_for(12000);
  CHECK(!r.board->player.busy((double)r.clock.t), "same id: no replay");
  r.server.msg = "{\"id\":6,\"style\":\"type\",\"lines\":[\"Gone out\"]}";
  r.server.v++;
  bool replayed = false;
  for (int i = 0; i < 4000 && !replayed; i++) {
    r.run_for(5);
    replayed = r.board->player.busy((double)r.clock.t);
  }
  CHECK(replayed, "a new message types out again");
}

static void test_announce_credits_roll_redraws_once_per_step() {
  Rig r;
  r.server.screen = "announce";
  r.server.msg = "{\"id\":3,\"style\":\"roll\",\"lines\":[\"Dinner at 7\",\"bring wine\"]}";
  r.board->connect();
  r.run_for(3000);
  CHECK(S(r.board) == "announce", "%s", S(r.board).c_str());
  CHECK(!r.board->player.busy((double)r.clock.t), "moves on the frame key, not every frame");
  long f0 = r.display.frames;
  r.run_for(15000);
  // 1 px every 150 ms (~100 steps), plus a redraw at each new second.
  long n = r.display.frames - f0;
  CHECK(n >= 95 && n <= 125, "%ld frames in 15 s", n);
}

static void test_announce_still_styles_draw_once() {
  Rig r;
  r.server.screen = "announce";
  r.server.msg = "{\"id\":1,\"style\":\"note\",\"lines\":[\"Dinner at 7\"]}";
  r.board->connect();
  r.run_for(3000);
  CHECK(S(r.board) == "announce", "%s", S(r.board).c_str());
  CHECK(!r.board->player.busy((double)r.clock.t), "");
  long f1 = r.display.frames;
  r.run_for(20000);
  // A new second or payload may redraw it; a note never animates.
  CHECK(r.display.frames - f1 <= 25, "%ld frames", r.display.frames - f1);
  int lit = 0;
  for (int y = 0; y < 32; y++)
    for (int x = 0; x < 64; x++)
      if (r.display.last.get(x, y) == draw::hexc(0xd8d8d8)) lit++;
  CHECK(lit > 30, "the note is drawn (%d px)", lit);
}

static void test_announce_without_a_message_asks_for_one() {
  Rig r;
  r.server.screen = "announce";
  r.board->connect();
  r.run_for(3000);
  int lit = 0;
  for (int y = 0; y < 32; y++)
    for (int x = 0; x < 64; x++)
      if (r.display.last.get(x, y) == draw::hexc(0x808080)) lit++;
  CHECK(lit > 20, "call to action (%d px)", lit);
}

static void test_clock_screen_fetches_its_cloud_strip_once_and_redraws_twenty_times_a_second() {
  Rig r;
  r.server.screen = "clock";
  r.board->connect();
  r.run_for(5000);
  CHECK(S(r.board) == "clock", "%s", S(r.board).c_str());
  r.run_for(60000);
  CHECK(r.server.count("sky:p1") == 1, "%d", r.server.count("sky:p1"));
  CHECK(r.board->player.clouds.count("p1") == 1, "");
  CHECK(!r.board->player.missing_cloud(), "");
  // Ambient motion: about twenty frames a second, with fetches still landing.
  long start = r.display.frames;
  r.run_for(30000);
  double per_s = (r.display.frames - start) / 30.0;
  CHECK(per_s > 15 && per_s < 24, "%f per s", per_s);
  CHECK(r.server.count("update") >= 2, "%d updates", r.server.count("update"));
  // A new sky: the new strip replaces the old one (once the crossfade is done).
  r.server.cloud = "o1";
  r.server.v++;
  r.run_for(30000);
  CHECK(r.server.count("sky:o1") == 1, "%d", r.server.count("sky:o1"));
  CHECK(r.board->player.clouds.size() == 1 && r.board->player.clouds.count("o1") == 1, "");
  // A clear sky fetches nothing.
  r.server.cloud = "";
  r.server.v++;
  int before = r.server.count("sky:");
  r.run_for(30000);
  CHECK(r.server.count("sky:") == before, "");
}

static void test_clock_screen_crossfades_a_new_sky_once_its_strip_is_here() {
  Rig r;
  r.server.screen = "clock";
  r.board->connect();
  r.run_for(20000);
  CHECK(r.board->player.clouds.count("p1") == 1, "");
  draw::RenderOpts o;
  r.board->player.sky_fade.view((double)r.clock.t, o);
  CHECK(!o.sky_from && o.sky_k == 1, "settled");
  // The sky changes: the old one stays up until the new strip lands, then fades out over 4 s.
  r.server.cloud = "o1";
  r.server.v++;
  for (int i = 0; i < 6000 && !r.board->player.clouds.count("o1"); i++) {
    r.board->player.sky_fade.view((double)r.clock.t, o);
    CHECK(!o.sky_from, "no fade before the strip is here");
    r.run_for(5);
  }
  CHECK(r.board->player.clouds.count("o1") == 1, "strip fetched");
  r.run_for(2000);
  r.board->player.sky_fade.view((double)r.clock.t, o);
  CHECK(o.sky_from && o.sky_k > 0.2 && o.sky_k < 0.8, "fading (k %f)", o.sky_k);
  CHECK((*o.sky_from)["cl"]["id"].eq("p1") && (*o.sky)["cl"]["id"].eq("o1"), "p1 -> o1");
  CHECK(r.board->player.clouds.count("p1") == 1, "the old strip is kept while it fades out");
  r.run_for(2500);
  r.board->player.sky_fade.view((double)r.clock.t, o);
  CHECK(!o.sky_from && o.sky_k == 1, "done after 4 s");
  CHECK(r.board->player.clouds.size() == 1 && r.board->player.clouds.count("o1") == 1, "then dropped");
}

static void test_cloud_strips_only_on_the_clock_screen() {
  Rig r;
  r.board->connect();
  r.run_for(60000);
  CHECK(r.server.count("sky:") == 0, "%d", r.server.count("sky:"));
}

static void test_clock_screen_draws_the_skyline() {
  Rig r;
  r.server.screen = "clock";
  r.board->connect();
  r.run_for(10000);
  // Buildings are black, the sky is blue, the temperature is on the bottom left.
  draw::RGB building = r.display.last.get(16, 10);  // St. Regis
  draw::RGB sky = r.display.last.get(40, 0);
  CHECK(building == draw::RGB{}, "St. Regis lit (%d,%d,%d)", building.r, building.g, building.b);
  CHECK(sky.b > sky.r && sky.b > 40, "sky (%d,%d,%d)", sky.r, sky.g, sky.b);
  int lit = 0;
  for (int y = 27; y <= 31; y++)
    for (int x = 0; x < 10; x++)
      if (r.display.last.get(x, y) == draw::hexc(0xd8d8d8)) lit++;
  CHECK(lit > 8, "temperature drawn (%d px)", lit);
  // Its dark sky goes black on the panel rather than lifted to the floor (color.h).
  CHECK(!r.display.last.floor, "the skyline opts out of the floor");
}

static void test_other_screens_keep_the_dim_color_floor() {
  Rig r;
  r.board->connect();
  r.run_for(10000);
  CHECK(S(r.board) == "transit", "%s", S(r.board).c_str());
  CHECK(r.display.last.floor, "transit keeps the floor");
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
  CHECK(S(r.board) == "ticker", "%s", S(r.board).c_str());
  r.run_for(70000);  // several updates, same version
  CHECK(S(r.board) == "ticker", "%s", S(r.board).c_str());
  press(false);
  CHECK(S(r.board) == "transit", "%s", S(r.board).c_str());
  press(false);
  CHECK(S(r.board) == "announce", "UP wraps around to the last screen: %s", S(r.board).c_str());
  r.server.v = 5;  // a phone change: the board follows the server again
  r.run_for(30000);
  CHECK(S(r.board) == "transit", "%s", S(r.board).c_str());
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

static void test_overnight_owl_redraws_when_it_blinks() {
  // No trains: the owl's frames (blinks, a glance) add redraws to the
  // once-a-second idle rate, without drawing every frame.
  Rig r;
  r.server.rows_fn = [](long long) { return std::string("[]"); };
  r.board->connect();
  r.run_for(5000);
  CHECK(r.board->player.night, "");
  long start = r.display.frames;
  r.run_for(5 * 60 * 1000);
  double per_s = (r.display.frames - start) / 300.0;
  CHECK(per_s > 1.5 && per_s < 3, "%f per s", per_s);
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
    const std::string &s = S(r.board);
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
  std::string pressed = S(r.board);
  CHECK(r.board->override_.screen.has_value(), "");
  r.run_for(200000);
  CHECK(S(r.board) == pressed, "%s", S(r.board).c_str());
}

static void test_no_visits_without_rain_or_when_off() {
  Rig r;
  r.server.radar_on = false;
  r.server.visit = "{\"every\":240,\"for\":60}";
  r.board->connect();
  r.run_for(5 * 60 * 1000);
  CHECK(S(r.board) == "transit", "");
  CHECK(r.server.count("radar") == 0, "");
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
  CHECK(r.led.state == (r.board->in_flight() ? "fetch" : "off"), "%s", r.led.state.c_str());
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

static void test_light_level_follows_log_lux_between_the_ends() {
  CHECK(light::level(0.01, 40) == 40, "dark: %f", light::level(0.01, 40));
  CHECK(light::level(light::DARK_LUX, 40) == 40, "");
  CHECK(light::level(1, 40) == 70, "halfway in log lux: %f", light::level(1, 40));
  CHECK(light::level(light::BRIGHT_LUX, 40) == 100, "");
  CHECK(light::level(5000, 40) == 100, "");
}

static const char *AB = "{\"min\":40}";

static Rig *light_rig(SimLight &l, bool hw = true) {
  Rig *r = new Rig;
  r->display.hw = hw;
  r->board->light = &l;
  r->server.ab = AB;
  r->board->connect();
  return r;
}

static void test_light_sensor_sets_auto_brightness_and_fades() {
  SimLight l;
  l.lux = 0.01;  // dark room
  std::unique_ptr<Rig> r(light_rig(l));
  r->run_for(5000);
  CHECK(r->display.k == 0.4, "dark room: the darkest level: %f", r->display.k);
  // The payload's level first, then a fade of about 2 s through the levels between.
  auto &ks = r->display.ks;
  CHECK(ks.front().second == 1, "%f", ks.front().second);
  long long t0 = -1, t1 = -1;
  int between = 0;
  for (auto &e : ks) {
    if (e.second < 1 && t0 < 0) t0 = e.first;
    if (e.second == 0.4 && t1 < 0) t1 = e.first;
    if (e.second < 1 && e.second > 0.4) between++;
  }
  CHECK(between > 20, "a gradual fade: %d steps", between);
  CHECK(t1 - t0 >= 1800 && t1 - t0 <= 2100, "fade time: %lld ms", t1 - t0);
  // A passing shadow or a flash doesn't move it.
  l.lux = 10;
  r->run_for(3000);
  l.lux = 0.01;
  r->run_for(10000);
  CHECK(r->display.k == 0.4, "brief change ignored: %f", r->display.k);
  // Lights on: after the hold, it fades up.
  l.lux = 10;
  r->run_for(7000);
  CHECK(r->display.k > 0.4 && r->display.k < 1, "fading up: %f", r->display.k);
  r->run_for(3000);
  CHECK(r->display.k == 1, "bright room: %f", r->display.k);
  // The phone's dark-room level moves it without the hold.
  l.lux = 0.01;
  r->run_for(10000);
  CHECK(r->display.k == 0.4, "%f", r->display.k);
  r->server.ab = "{\"min\":20}";
  r->server.v++;
  r->run_for(15000);
  CHECK(fabs(r->display.k - 0.2) < 1e-9, "dark-room level: %f", r->display.k);
}

static void test_light_sensor_gives_way_to_fixed_and_to_a_missing_sensor() {
  SimLight l;
  l.lux = 0.01;
  std::unique_ptr<Rig> r(light_rig(l));
  r->run_for(8000);
  CHECK(r->display.k == 0.4, "%f", r->display.k);
  // Fixed on the phone (no `ab`): the payload's level.
  r->server.ab = "null";
  r->server.bright = 70;
  r->server.v++;
  r->run_for(15000);
  CHECK(fabs(r->display.k - 0.7) < 1e-9, "fixed: %f", r->display.k);
  // Back to auto, then the sensor stops answering: the payload's level.
  r->server.ab = AB;
  r->server.bright = 100;
  r->server.v++;
  r->run_for(20000);
  CHECK(r->display.k == 0.4, "auto again: %f", r->display.k);
  l.ok = false;
  r->run_for(12000);
  CHECK(r->display.k == 1, "sensor gone: %f", r->display.k);
}

static void test_light_sensor_reports_lux_with_health() {
  SimLight l;
  l.lux = 0.42;
  std::unique_ptr<Rig> r(light_rig(l));
  r->run_for(70000);
  std::string h = last_health(*r);
  CHECK(h.find("&ha=0.42") != std::string::npos, "%s", h.c_str());
  // The reading is current on every check, not once a minute with the rest.
  l.lux = 5;
  r->run_for(35000);
  h = last_health(*r);
  size_t at = h.find("&ha=");
  double lx = at == std::string::npos ? 0 : atof(h.c_str() + at + 4);
  CHECK(lx > 4.5 && lx <= 5, "fresh within ~30 s: %s", h.c_str());
  Rig none;
  none.board->connect();
  none.run_for(70000);
  CHECK(last_health(none).find("&ha=") == std::string::npos, "no sensor, no reading");
}

static void test_low_levels_dim_in_hardware_then_in_the_colors() {
  // Below the window's floor (~28%) a hardware-dimmed display draws scaled
  // frames for the rest; at the default night level (40%) it doesn't.
  Rig r;
  r.display.hw = true;
  r.server.bright = 10;
  r.board->connect();
  r.run_for(5000);
  double share = 0.1 / pow(color::HW_MIN_OE / 255.0, 1 / 2.2);
  CHECK(!r.board->player.hw_bright, "");
  CHECK(r.display.max_px > 0 && r.display.max_px <= (int)(255 * share + 1), "scaled frame: %d", r.display.max_px);
  r.server.bright = 40;
  r.server.v++;
  r.run_for(15000);
  CHECK(r.board->player.hw_bright && r.display.max_px > 200, "full frame: %d", r.display.max_px);
}

static void test_light_sensor_scales_colors_without_hardware_dimming() {
  SimLight l;
  l.lux = 0.01;
  std::unique_ptr<Rig> r(light_rig(l, false));
  r->run_for(8000);
  CHECK(r->display.max_px <= (int)(255 * 0.4 + 1), "scaled frame: %d", r->display.max_px);
}


// ---- knob ----

static Rig *knob_rig() {
  Rig *r = new Rig({"ok"}, false, false, 0, "", "", true);
  r->board->connect();
  r->run_for(5000);
  return r;
}

static bool amber(const draw::Frame &f, int x, int y) { return f.get(x, y) == draw::C::amber; }

static void test_knob_twist_and_rest_selects_once() {
  std::unique_ptr<Rig> r(knob_rig());
  size_t before = r->server.calls.size();
  long long opened = r->clock.t;
  r->knob.pending = 1;
  r->run_for(300);
  CHECK(r->board->chooser.open, "the first click opens the chooser");
  // Pips start at x23, 5 apart: WEATHER (2) is the selection.
  CHECK(amber(r->display.last, 33, 9) && !amber(r->display.last, 28, 9), "WEATHER's pip");
  CHECK(S(r->board) == "transit", "nothing switches while turning: %s", S(r->board).c_str());
  r->knob.pending = 1;
  r->run_for(600);
  CHECK(r->board->chooser.open, "still turning");
  CHECK(r->server.selects.empty(), "no commit before the rest");
  r->run_for(1500 + LATENCY);
  CHECK(!r->board->chooser.open, "closed after committing");
  CHECK(r->server.selects == std::vector<std::string>({"sports"}), "%zu", r->server.selects.size());
  CHECK(S(r->board) == "baseball", "%s", S(r->board).c_str());
  // Nothing else ran while the chooser was open (the version check waited).
  for (size_t i = before; i < r->server.calls.size(); i++) {
    const Call &c = r->server.calls[i];
    if (c.name.compare(0, 7, "select:") == 0) break;
    CHECK(c.ms < opened, "%s at %lld while choosing", c.name.c_str(), c.ms);
  }
  // The select's payload is the new screen's: no extra update right after.
  long long sel = r->server.times("select:")[0];
  r->run_for(5000);
  for (long long t : r->server.times("update")) CHECK(t < sel || t > sel + 5000, "update at %lld", t);
}

static void test_knob_first_turn_only_ends_a_rain_visit() {
  // Rain nearby (spec §10, "Interruptions"): during a visit the first turn
  // ends it (back to the chosen screen until the next visit); the next turn
  // opens the chooser.
  std::unique_ptr<Rig> r(knob_rig());
  r->server.radar_on = true;
  r->server.visit = "{\"every\":240,\"for\":60}";
  r->board->sched.due_now(&r->board->update_job, (double)r->clock.t);
  while (!(draw::fmod_floor(r->board->now(r->clock.t), 240) >= 5 && draw::fmod_floor(r->board->now(r->clock.t), 240) < 20))
    r->run_for(500);
  CHECK(S(r->board) == "weather", "visiting: %s", S(r->board).c_str());
  r->knob.pending = 1;
  r->run_for(300);
  CHECK(!r->board->chooser.open, "the first turn doesn't open the chooser");
  CHECK(S(r->board) == "transit", "the visit ended: %s", S(r->board).c_str());
  r->run_for(20000);
  CHECK(S(r->board) == "transit", "and stays ended: %s", S(r->board).c_str());
  CHECK(r->server.count("select:") == 0, "%d", r->server.count("select:"));
  r->knob.pending = 1;
  r->run_for(300);
  CHECK(r->board->chooser.open, "the next turn opens it");
  r->run_for(3000);
  // The next visit comes as usual.
  while (draw::fmod_floor(r->board->now(r->clock.t), 240) >= 3) r->run_for(500);
  r->run_for(3000);
  CHECK(S(r->board) == "weather", "the next visit: %s", S(r->board).c_str());
}

static void test_rain_visits_interrupt_the_clock_too() {
  long long now = T0 - draw::fmod_floor(T0, 240);  // inside a visit
  const std::string tail = ",\"radar\":{\"on\":true,\"visit\":{\"every\":240,\"for\":60}}}";
  player::Player pl;
  for (const char *sc : {"clock", "announce"}) {
    pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"screen\":\"" + sc + "\"" + tail), 0);
    CHECK(pl.auto_screen(now) == screen::Screen::Weather, "%s gets visits", sc);
    CHECK(pl.visiting(now), "%s", sc);
  }
  pl.visit_skip_until = now + 60;
  CHECK(pl.auto_screen(now) == screen::Screen::Announce, "skipped");
  CHECK(!pl.visiting(now), "");
  // The Cycle's weather turn isn't a visit, and wants frames.
  pl.visit_skip_until = 0;
  pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"screen\":\"transit\",\"rot\":{\"screens\":[\"weather\",\"transit\"],\"every\":60}"
                       ",\"radar\":{\"on\":false,\"visit\":null}}"), 0);
  CHECK(pl.auto_screen(now) == screen::Screen::Weather, "the weather turn");
  CHECK(!pl.visiting(now), "not a visit");
  CHECK(pl.wants_frames(), "frames ahead of the weather turn");
}

static void test_knob_turns_an_off_panel_back_on() {
  std::unique_ptr<Rig> r(knob_rig());
  r->server.bright = 0;
  r->board->sched.due_now(&r->board->update_job, (double)r->clock.t);
  r->run_for(2000);
  r->knob.pending = 1;
  r->run_for(300 + LATENCY);
  CHECK(!r->board->chooser.open, "no chooser on a dark panel");
  CHECK(r->server.selects.size() == 1 && r->server.selects[0] == "transit", "%zu", r->server.selects.size());
}

static void test_knob_back_to_the_start_cancels() {
  std::unique_ptr<Rig> r(knob_rig());
  r->knob.pending = 1;
  r->run_for(300);
  r->knob.pending = -1;
  r->run_for(2000);
  CHECK(!r->board->chooser.open, "");
  CHECK(r->server.count("select:") == 0, "%d", r->server.count("select:"));
  CHECK(S(r->board) == "transit", "%s", S(r->board).c_str());
  CHECK(!amber(r->display.last, 28, 9), "the transit screen is back");
}

static void test_knob_wraps_around_the_ring() {
  std::unique_ptr<Rig> r(knob_rig());
  r->knob.pending = -2;  // TRANSIT, AUTO, then around to SPORTS
  r->run_for(2000);
  CHECK(r->server.selects == std::vector<std::string>({"sports"}), "%s", r->server.selects.empty() ? "" : r->server.selects[0].c_str());
  r->knob.pending = 2;  // SPORTS, AUTO, TRANSIT... from SPORTS: AUTO then TRANSIT
  r->run_for(2000);
  CHECK(r->server.selects.size() == 2 && r->server.selects[1] == "transit", "%zu", r->server.selects.size());
}

static void test_knob_select_failure_keeps_the_screen() {
  std::unique_ptr<Rig> r(knob_rig());
  r->server.fail_next = 1;
  r->knob.pending = 1;
  r->run_for(2000 + LATENCY);
  CHECK(!r->board->chooser.open, "");
  CHECK(S(r->board) == "transit", "%s", S(r->board).c_str());
  CHECK(r->board->last_error == "select:OSError", "%s", r->board->last_error.c_str());
  r->knob.pending = 1;  // works again next time
  r->run_for(2000 + LATENCY);
  CHECK(S(r->board) == "weather", "%s", S(r->board).c_str());
}

static void test_knob_waits_for_the_ring() {
  // A server without the ring: turns are ignored.
  Rig r({"ok"}, false, false, 0, "", "", true);
  r.server.knob_ring = false;
  r.board->connect();
  r.knob.pending = 1;
  r.run_for(2000);
  CHECK(!r.board->chooser.open && r.server.count("select:") == 0, "");
}

// ---- peek chooser (contract "Peek") ----

static Rig *peek_rig() {
  Rig *r = new Rig({"ok"}, false, false, 0, "", "", true);
  r->server.peek = true;
  r->board->connect();
  r->run_for(5000);
  return r;
}

static draw::RGB px(const std::unique_ptr<Rig> &r, int x, int y) { return r->display.last.get(x, y); }
static const draw::RGB SUN = draw::hexc(0xffd040), CLOCK_C = draw::hexc(0xf0e2c8);

// Press the knob for `hold` ms, then let go.
static void press(const std::unique_ptr<Rig> &r, long long hold = 120) {
  r->knob.down = true;
  r->run_for(hold);
  r->knob.down = false;
}

static void test_peek_turn_shows_the_view_press_steps_the_variant_rest_commits() {
  std::unique_ptr<Rig> r(peek_rig());
  r->knob.pending = 1;
  r->run_for(400);
  CHECK(r->board->peek.open && !r->board->chooser.open, "the peek chooser, not the wheel");
  CHECK(r->board->peek.k == 1 && r->board->peek.vi() == 0, "weather, conditions: %d %d", r->board->peek.k, r->board->peek.vi());
  // The bar is up: the sun icon (x16, rows 23-29) lit in its color, the underline under it.
  CHECK(px(r, 19, 23) == SUN && px(r, 16, 31) == SUN, "weather lit");
  CHECK(S(r->board) == "transit", "nothing switches while turning: %s", S(r->board).c_str());
  press(r);
  r->run_for(400);
  CHECK(r->board->peek.vi() == 1, "a press steps to 5-day: %d", r->board->peek.vi());
  CHECK(r->server.selects.empty(), "no commit before the rest");
  r->run_for(1200 + LATENCY);
  CHECK(r->server.selects == std::vector<std::string>({"weather"}), "%zu", r->server.selects.size());
  CHECK(r->server.variants == std::vector<std::string>({"5day"}), "%s", r->server.variants.empty() ? "" : r->server.variants[0].c_str());
  r->run_for(600);
  CHECK(!r->board->peek.open, "closed once the bar dropped and the answer landed");
  CHECK(S(r->board) == "weather", "%s", S(r->board).c_str());
}

static void test_peek_back_to_the_start_cancels() {
  std::unique_ptr<Rig> r(peek_rig());
  r->knob.pending = 1;
  r->run_for(300);
  r->knob.pending = -1;
  r->run_for(1300);
  CHECK(r->board->peek.closing && !r->board->peek.committing, "dropping, nothing to send");
  r->run_for(600);
  CHECK(!r->board->peek.open, "");
  CHECK(r->server.count("select:") == 0, "%d", r->server.count("select:"));
  CHECK(S(r->board) == "transit", "%s", S(r->board).c_str());
}

static void test_peek_hold_and_turn_steps_variants_both_ways() {
  std::unique_ptr<Rig> r(peek_rig());
  r->knob.pending = 2;  // transit -> clock
  r->run_for(400);
  CHECK(r->board->peek.k == 2, "%d", r->board->peek.k);
  CHECK(px(r, 31, 31) == CLOCK_C, "clock's underline at x28");
  r->knob.down = true;
  r->run_for(100);
  r->knob.pending = -1;  // held: back one face, wrapping to analog
  r->run_for(300);
  CHECK(r->board->peek.vi() == 2, "analog: %d", r->board->peek.vi());
  r->run_for(1500);
  CHECK(r->server.selects.empty(), "no commit while held");
  r->knob.down = false;  // let go after turning: no extra step
  r->run_for(300);
  CHECK(r->board->peek.vi() == 2, "%d", r->board->peek.vi());
  r->run_for(1500 + LATENCY);
  CHECK(r->server.variants == std::vector<std::string>({"analog"}), "%zu", r->server.variants.size());
}

static void test_peek_press_on_a_live_screen_steps_its_variant() {
  std::unique_ptr<Rig> r(peek_rig());
  press(r);
  r->run_for(300);
  CHECK(r->board->peek.open && r->board->peek.k == 0 && r->board->peek.vi() == 1, "transit, ticker");
  r->run_for(1500 + LATENCY);
  CHECK(r->server.selects == std::vector<std::string>({"transit"}) && r->server.variants[0] == "ticker", "");
  r->run_for(600);
  CHECK(S(r->board) == "ticker", "%s", S(r->board).c_str());
}

static void test_peek_prefetches_radar_frames_and_clouds() {
  // On the transit screen, a peek board still fetches what the radar view
  // and the skyline need, so they're on hand before the knob turns.
  std::unique_ptr<Rig> r(peek_rig());
  r->run_for(20000);
  CHECK(r->server.count("radar:") >= 3, "radar frames: %d", r->server.count("radar:"));
  CHECK(r->server.count("sky:") == 1, "the cloud strip: %d", r->server.count("sky:"));
  CHECK(r->board->player.clouds.count("p1") == 1, "kept");
  CHECK(S(r->board) == "transit", "%s", S(r->board).c_str());
}

static void test_peek_survives_a_long_burst_of_turns_and_presses() {
  // Turning and pressing fast for a while, payloads landing in between: the
  // views stay overlays on the payload (no copies piling up), and the knob
  // still commits afterwards.
  std::unique_ptr<Rig> r(peek_rig());
  unsigned seed = 7;
  auto rnd = [&](int n) {
    seed = seed * 1103515245u + 12345u;
    return (int)((seed >> 16) % (unsigned)n);
  };
  for (int i = 0; i < 400; i++) {
    int what = rnd(4);
    if (what == 0) r->knob.pending = rnd(7) - 3;
    else if (what == 1) r->knob.down = !r->knob.down;
    r->run_for(30 + rnd(400));
  }
  r->knob.down = false;
  r->run_for(4000 + LATENCY);
  CHECK(!r->board->peek.open, "closed after the burst");
  size_t before = r->server.selects.size();
  r->knob.pending = 1;
  r->run_for(2500 + LATENCY);
  CHECK(r->server.selects.size() == before + 1, "still commits: %zu -> %zu", before, r->server.selects.size());
  CHECK(!r->board->peek.open, "");
}

static void test_phone_screen_change_fades() {
  Rig r;
  r.board->connect();
  r.run_for(15000);
  draw::Frame before = r.display.last;
  r.server.v = 2;
  r.server.screen = "ticker";
  while (S(r.board) != "ticker") {
    r.board->step();
    r.clock.sleep_ms(5);
  }
  // A phone change: the switch's frame starts a fade (not a slide) on the
  // old screen.
  CHECK(r.board->fading(r.clock.t) && !r.board->sliding(r.clock.t), "");
  long frames = r.display.frames;
  r.run_for(60);
  draw::Frame out = r.display.last;  // fading out: the old screen, dimmer
  int lit_before = 0, brighter = 0;
  for (size_t i = 0; i < sizeof out.px; i++) {
    lit_before += before.px[i] > 0;
    if (out.px[i] > before.px[i]) brighter++;
  }
  CHECK(lit_before > 0 && brighter == 0, "fading out never brightens: %d", brighter);
  r.run_for(250);
  CHECK(!r.board->fading(r.clock.t), "");
  CHECK(r.display.frames - frames >= 5, "%ld frames in the fade", r.display.frames - frames);
}

static void test_buttons_slide_the_way_pressed() {
  Rig r({"ok"}, true);
  r.board->connect();
  r.run_for(5000);
  auto press = [&](bool down) {
    (down ? r.btn.held_down : r.btn.held_up) = true;
    std::string was = S(r.board);
    while (S(r.board) == was) {
      r.board->step();
      r.clock.sleep_ms(5);
    }
  };
  press(true);  // DOWN: transit -> ticker, from the right
  CHECK(S(r.board) == "ticker" && r.board->sliding(r.clock.t) && r.board->slide_dir() == 1, "%d", r.board->slide_dir());
  r.btn.held_down = false;
  r.run_for(1000);
  press(false);  // UP: back to transit, from the left
  CHECK(S(r.board) == "transit" && r.board->sliding(r.clock.t) && r.board->slide_dir() == -1, "%d", r.board->slide_dir());
  r.btn.held_up = false;
  r.run_for(1000);
  press(false);  // UP wraps to the last screen: still from the left (the press, not the order)
  CHECK(S(r.board) == "announce" && r.board->sliding(r.clock.t) && r.board->slide_dir() == -1, "%d", r.board->slide_dir());
  r.btn.held_up = false;
  r.run_for(1000);
  // A phone change after the presses fades.
  r.server.v = 7;
  while (S(r.board) != "transit") {
    r.board->step();
    r.clock.sleep_ms(5);
  }
  CHECK(r.board->fading(r.clock.t), "");
}

static void test_presses_in_a_row_chain_quick_slides_without_a_jump() {
  Rig r({"ok"}, true);
  r.board->connect();
  r.run_for(5000);
  // Until the new screen's first frame is drawn, keeping the frame shown
  // just before it.
  auto press_down = [&](draw::Frame &prev) {
    r.btn.held_down = true;
    std::string was = S(r.board);
    for (;;) {
      draw::Frame cur = r.display.last;
      long f0 = r.display.frames;
      r.board->step();
      r.clock.sleep_ms(5);
      if (S(r.board) != was && r.display.frames != f0) {
        prev = cur;
        break;
      }
    }
    r.btn.held_down = false;
  };
  draw::Frame prev;
  press_down(prev);  // transit -> ticker: a full slide
  CHECK(r.board->sliding(r.clock.t) && r.board->slide_ms() == draw::SCREEN_SLIDE_MS, "%g", r.board->slide_ms());
  r.run_for(150);  // mid-slide
  press_down(prev);  // ticker -> weather, before the first slide is done
  CHECK(S(r.board) == "weather", "%s", S(r.board).c_str());
  CHECK(r.board->sliding(r.clock.t) && r.board->slide_dir() == 1, "");
  CHECK(r.board->slide_ms() < draw::SCREEN_SLIDE_MS, "a slide that interrupts one is quicker: %g", r.board->slide_ms());
  // It starts from what was on the panel (the half-slid frame), not the
  // ticker on its own: no snap.
  CHECK(memcmp(prev.px, r.display.last.px, sizeof prev.px) == 0, "the interrupting slide starts on the shown frame");
  r.run_for((long long)r.board->slide_ms() + 50);
  CHECK(!r.board->sliding(r.clock.t), "");
  // Once settled, the next press is a full slide again.
  r.run_for(1000);
  press_down(prev);
  CHECK(r.board->slide_ms() == draw::SCREEN_SLIDE_MS, "%g", r.board->slide_ms());
}

static void test_a_turn_mid_slide_shows_the_chooser_at_once() {
  std::unique_ptr<Rig> r(knob_rig());
  r->knob.pending = 1;
  r->run_for(1100);
  while (r->board->chooser.open) {
    r->board->step();
    r->clock.sleep_ms(5);
  }
  CHECK(r->board->sliding(r->clock.t), "");
  r->run_for(100);
  r->knob.pending = 1;  // turned again mid-slide
  long seen = r->display.frames;
  while (r->display.frames == seen || !r->board->chooser.open) {
    r->board->step();
    r->clock.sleep_ms(5);
  }
  CHECK(r->clock.t - r->board->trans_start() < draw::SCREEN_SLIDE_MS, "still inside the old slide's time");
  CHECK(r->board->chooser.open && !r->board->transitioning(r->clock.t), "the chooser cuts the slide short");
}

static void test_knob_choice_slides_the_way_the_knob_turned() {
  std::unique_ptr<Rig> r(knob_rig());
  r->knob.pending = 1;  // clockwise to WEATHER
  r->run_for(1100);
  while (r->board->chooser.open) {
    r->board->step();
    r->clock.sleep_ms(5);
  }
  CHECK(S(r->board) == "weather", "%s", S(r->board).c_str());
  CHECK(r->board->sliding(r->clock.t) && r->board->slide_dir() == 1, "%d", r->board->slide_dir());
  r->run_for(2000);
  r->knob.pending = -1;  // back to TRANSIT
  r->run_for(1100);
  while (r->board->chooser.open) {
    r->board->step();
    r->clock.sleep_ms(5);
  }
  CHECK(S(r->board) == "transit", "%s", S(r->board).c_str());
  CHECK(r->board->sliding(r->clock.t) && r->board->slide_dir() == -1, "%d", r->board->slide_dir());
}

// ---- the network worker (S3): requests off the draw loop ----

static void test_worker_animations_never_wait_for_a_request() {
  Rig r;
  r.server.screen = "ticker";  // a slide every few seconds
  r.server.tornado = 1;        // and a blink
  r.board->connect();
  long long last = r.clock.t, worst = 0;
  long frames = r.display.frames;
  int during = 0;
  for (int i = 0; i < 10 * 60 * 1000 / 5; i++) {
    r.board->step();
    if (r.display.frames != frames) {
      frames = r.display.frames;
      last = r.clock.t;
      if (r.board->in_flight()) during++;
    } else if (r.board->player.busy((double)r.clock.t)) {
      worst = std::max(worst, r.clock.t - last);
    }
    r.clock.sleep_ms(5);
  }
  CHECK(worst <= 60, "%lld ms without a frame mid-animation", worst);
  CHECK(during > 100, "%d frames drawn while a request was out", during);
}

static void test_worker_keeps_data_fresh_one_request_at_a_time() {
  Rig r;
  r.board->connect();
  r.run_for(10 * 60 * 1000);
  std::vector<long long> t;
  for (const Call &c : r.server.calls) t.push_back(c.ms);
  long long closest = 1LL << 40;
  for (size_t i = 1; i < t.size(); i++) closest = std::min(closest, t[i] - t[i - 1]);
  CHECK(closest >= LATENCY, "two requests %lld ms apart", closest);
  CHECK(max_gap(r.server.times("update")) <= UPDATE_GAP_MAX, "%lld", max_gap(r.server.times("update")));
  CHECK(max_gap(r.server.times("version")) <= 13000, "%lld", max_gap(r.server.times("version")));
}

static void test_worker_a_hung_request_lets_the_watchdog_restart_the_board() {
  Rig r;
  SimWatchdog wd(&r.clock);
  r.board->watchdog = &wd;
  r.board->connect();
  r.run_for(5000);
  r.server.latency = [] { return 0LL; };
  r.worker.hang = true;
  while (!r.board->in_flight()) {
    r.board->step();
    r.clock.sleep_ms(5);
  }
  long long hung_at = r.clock.t;
  r.run_for(30000);
  CHECK(wd.last >= r.clock.t - 50, "still fed while the request is young");
  r.run_for(30000);
  CHECK(wd.last >= hung_at + app::WORK_STUCK_MS - 100 && wd.last < hung_at + app::WORK_STUCK_MS + 100,
        "last fed %lld ms after the hang", wd.last - hung_at);
  CHECK(r.display.frames > 0, "");
}

static void test_worker_knob_commit_waits_for_the_request_out() {
  std::unique_ptr<Rig> r(knob_rig());
  r->server.latency = [] { return 4000LL; };  // a slow request
  // Start a request, then turn: the choice goes out after it lands.
  r->board->update_job.due_at = 0;
  while (!r->board->in_flight()) {
    r->board->step();
    r->clock.sleep_ms(5);
  }
  r->knob.pending = 1;
  r->run_for(10000);
  CHECK(r->server.selects == std::vector<std::string>({"weather"}), "%zu", r->server.selects.size());
  CHECK(S(r->board) == "weather", "%s", S(r->board).c_str());
  CHECK(!r->board->chooser.open, "");
}

static void test_without_a_worker_requests_block_but_still_run() {
  // The worker's task couldn't start: requests run inline on the loop.
  Rig r;
  r.board->worker = nullptr;
  r.board->connect();
  r.run_for(5 * 60 * 1000);
  CHECK(r.worker.started == 0, "%d", r.worker.started);
  CHECK(!r.board->in_flight(), "");
  CHECK(max_gap(r.server.times("update")) <= UPDATE_GAP_MAX, "%lld", max_gap(r.server.times("update")));
  CHECK(max_gap(r.server.times("version")) <= 13000, "%lld", max_gap(r.server.times("version")));
}

static void test_unknown_screen_names_draw_as_transit_without_visits() {
  // A screen this build doesn't know draws as transit, but (as in draw.js)
  // only transit, ticker and baseball by name get weather visits.
  long long now = T0 - draw::fmod_floor(T0, 240);  // inside a visit
  const std::string tail = ",\"radar\":{\"on\":true,\"visit\":{\"every\":240,\"for\":60}}}";
  player::Player pl;
  pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"screen\":\"ticker\"" + tail), 0);
  CHECK(pl.auto_screen(now) == screen::Screen::Weather, "ticker gets visits");
  pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"screen\":\"nfl\"" + tail), 0);
  CHECK(pl.auto_screen(now) == screen::Screen::Transit, "%s", screen::name(pl.auto_screen(now)));
  pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"screen\":7" + tail), 0);
  CHECK(pl.auto_screen(now) == screen::Screen::Transit, "%s", screen::name(pl.auto_screen(now)));
  pl.set_payload(parse("{\"now\":" + jnum(now) + ",\"screen\":\"\"" + tail), 0);
  CHECK(pl.auto_screen(now) == screen::Screen::Weather, "empty is transit, visits included");
}

static void test_overdue_jobs_go_before_older_due_ones() {
  auto none = [](double) { return sched::OK; };
  sched::Job a("logo", 3000, 120000, none, 0), b("version", 10000, 20000, none, 5000);
  sched::Scheduler s;
  s.add(&a);
  s.add(&b);
  CHECK(s.pick(10000, false) == &a, "earliest due when none is overdue");
  CHECK(s.pick(10000, true) == nullptr, "nothing overdue");
  CHECK(s.pick(30000, false) == &b, "the overdue one first");
  CHECK(s.pick(30000, true) == &b, "");
}

int main() {
  struct T {
    const char *name;
    void (*fn)();
  } tests[] = {
#define T_(f) {#f, f}
      T_(test_a_held_train_stays_due_until_the_server_drops_it),
      T_(test_health_reports_the_skyline_capability),
      T_(test_announce_typewriter_animates_its_intro_then_redraws_only_for_the_cursor),
      T_(test_announce_credits_roll_redraws_once_per_step),
      T_(test_announce_still_styles_draw_once),
      T_(test_announce_without_a_message_asks_for_one),
      T_(test_clock_screen_fetches_its_cloud_strip_once_and_redraws_twenty_times_a_second),
      T_(test_clock_screen_crossfades_a_new_sky_once_its_strip_is_here),
      T_(test_cloud_strips_only_on_the_clock_screen),
      T_(test_clock_screen_draws_the_skyline),
      T_(test_overnight_owl_redraws_when_it_blinks),
      T_(test_other_screens_keep_the_dim_color_floor),
      T_(test_settings_change_shows_up_fast),
      T_(test_radar_frames_only_on_the_radar_screen_and_once_each),
      T_(test_radar_frames_stay_current_over_many_loops),
      T_(test_radar_loop_fills_in_back_to_back),
      T_(test_logos_only_on_the_baseball_screen_and_once_each),
      T_(test_logos_hold_the_current_and_next_game),
      T_(test_a_button_press_fetches_the_new_screens_sections_right_away),
      T_(test_health_rides_on_the_version_check_once_a_minute),
      T_(test_health_uptime_counts_from_this_run_and_names_the_last_crash),
      T_(test_health_names_the_hardware_and_firmware_build),
      T_(test_live_games_update_faster),
      T_(test_buttons_override_until_the_phone_changes_something),
      T_(test_status_screens_and_retry),
      T_(test_first_retries_come_quickly),
      T_(test_reconnects_after_repeated_failures),
      T_(test_line_alerts_dont_blink),
      T_(test_time_follows_the_server),
      T_(test_syncs_never_set_the_clock_back_while_it_is_right),
      T_(test_a_drifting_clock_is_pulled_back_in),
      T_(test_idle_screens_redraw_only_when_something_changes),
      T_(test_auto_visits_the_radar_on_a_timer_and_prefetches_frames),
      T_(test_buttons_beat_the_timer),
      T_(test_no_visits_without_rain_or_when_off),
      T_(test_unknown_screen_names_draw_as_transit_without_visits),
      T_(test_overdue_jobs_go_before_older_due_ones),
      T_(test_led_blue_during_each_request_and_off_between),
      T_(test_led_connecting_portal_and_offline),
      T_(test_led_dim_red_after_a_failure_until_a_request_succeeds),
      T_(test_led_red_while_reconnecting_after_repeated_failures),
      T_(test_brightness_in_hardware_or_in_the_colors),
      T_(test_light_level_follows_log_lux_between_the_ends),
      T_(test_light_sensor_sets_auto_brightness_and_fades),
      T_(test_light_sensor_gives_way_to_fixed_and_to_a_missing_sensor),
      T_(test_light_sensor_reports_lux_with_health),
      T_(test_light_sensor_scales_colors_without_hardware_dimming),
      T_(test_low_levels_dim_in_hardware_then_in_the_colors),
      T_(test_knob_twist_and_rest_selects_once),
      T_(test_knob_back_to_the_start_cancels),
      T_(test_knob_first_turn_only_ends_a_rain_visit),
      T_(test_rain_visits_interrupt_the_clock_too),
      T_(test_knob_turns_an_off_panel_back_on),
      T_(test_knob_wraps_around_the_ring),
      T_(test_knob_select_failure_keeps_the_screen),
      T_(test_knob_waits_for_the_ring),
      T_(test_peek_turn_shows_the_view_press_steps_the_variant_rest_commits),
      T_(test_peek_back_to_the_start_cancels),
      T_(test_peek_hold_and_turn_steps_variants_both_ways),
      T_(test_peek_press_on_a_live_screen_steps_its_variant),
      T_(test_peek_prefetches_radar_frames_and_clouds),
      T_(test_peek_survives_a_long_burst_of_turns_and_presses),
      T_(test_setup_opens_right_away_with_no_networks),
      T_(test_a_new_owner_wipe_forgets_wifi_once_per_stamp),
      T_(test_setup_opens_after_ten_minutes_without_wifi),
      T_(test_setup_never_opens_while_the_server_is_down),
      T_(test_setup_reopens_when_the_new_network_fails_and_clears_after_a_join),
      T_(test_ota_installs_an_offered_build_between_animations),
      T_(test_ota_passes_the_signature_and_ignores_unsigned_offers),
      T_(test_ota_leaves_the_running_build_alone),
      T_(test_ota_failed_download_carries_on_and_retries_later),
      T_(test_ota_trial_build_is_kept_once_it_has_reached_the_server),
      T_(test_ota_trial_build_that_cant_reach_the_server_rolls_back),
      T_(test_ota_rolled_back_offer_waits_for_try_again),
      T_(test_ota_boot_counts_trial_starts),
      T_(test_phone_screen_change_fades),
      T_(test_buttons_slide_the_way_pressed),
      T_(test_presses_in_a_row_chain_quick_slides_without_a_jump),
      T_(test_a_turn_mid_slide_shows_the_chooser_at_once),
      T_(test_knob_choice_slides_the_way_the_knob_turned),
      T_(test_worker_animations_never_wait_for_a_request),
      T_(test_worker_keeps_data_fresh_one_request_at_a_time),
      T_(test_worker_a_hung_request_lets_the_watchdog_restart_the_board),
      T_(test_worker_knob_commit_waits_for_the_request_out),
      T_(test_without_a_worker_requests_block_but_still_run),
#undef T_
  };
  int n = 0, total = 0;
  for (const T &t : tests) {
    g_test = t.name;
    int before = g_failed;
    total++;
    t.fn();
    if (g_failed == before) n++;
    else printf("  in %s\n", g_test.c_str());
  }
  printf("%d of %d tests passed (%d checks, %d failed)\n", n, total, g_checks, g_failed);
  return g_failed ? 1 : 0;
}
