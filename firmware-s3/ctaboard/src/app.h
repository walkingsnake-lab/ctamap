// The board's main loop: connects, keeps the payload fresh, and draws.
// A port of firmware/boardlib/app.py (Board).
//
// Board takes its hardware as interfaces so the whole loop runs natively
// against a fake network and clock (firmware-s3/tests/app_test.cpp):
//   Net      - connect / version / update / radar / logo; false on failure
//   Display  - show(fn): fn fills a fresh frame, then it's shown
//   Clock    - ms(): monotonic milliseconds; sleep_ms()
//   Buttons, Knob, Watchdog, Led - optional
#pragma once

#include <stdint.h>

#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "control.h"
#include "draw.h"
#include "json.h"
#include "player.h"
#include "sched.h"

namespace app {

using json::Value;
using Networks = std::vector<std::pair<std::string, std::string>>;  // (ssid, password), tried in order
using StatusFn = std::function<void(const std::string &kind, const std::string &detail)>;

struct ConnectResult {
  std::string result;  // "ok", "portal", or "nowifi"
  std::string detail;  // the network (ok) or the MAC address (portal)
};

class Net {
 public:
  virtual ~Net() {}
  virtual ConnectResult connect(const Networks &networks, const StatusFn &status) = 0;
  // Each returns false on failure, with a short reason in err (letters only:
  // it goes into the health report's URL).
  virtual bool version(const std::string &health, Value &out, std::string &err) = 0;
  virtual bool update(bool boot, const std::string &screen, Value &out, std::string &err) = 0;
  virtual bool radar(const std::string &id, std::vector<uint8_t> &out, std::string &err) = 0;
  virtual bool logo(const std::string &id, std::vector<uint8_t> &out, std::string &err) = 0;
  // The knob chose a category (/board/select): out is the update for its screen.
  virtual bool select(const std::string &category, Value &out, std::string &err) {
    (void)category;
    (void)out;
    err = "Unsupported";
    return false;
  }
  virtual bool rssi(int &out) { (void)out; return false; }
};

class Display {
 public:
  virtual ~Display() {}
  virtual void show(const std::function<void(draw::Frame &)> &fn) = 0;
  // The payload's brightness (0-1). True when the display dims in hardware,
  // so frames are drawn at full brightness; false: the renderer scales them.
  virtual bool set_brightness(double k) {
    (void)k;
    return false;
  }
};

class Clock {
 public:
  virtual ~Clock() {}
  virtual long long ms() = 0;
  virtual void sleep_ms(long long ms) = 0;
};

class Buttons {
 public:
  virtual ~Buttons() {}
  virtual bool up() = 0;
  virtual bool down() = 0;
};

// The rotary encoder (spec §10, "Knob"): clicks since the last call,
// + clockwise.
class Knob {
 public:
  virtual ~Knob() {}
  virtual int clicks() = 0;
};

class Watchdog {
 public:
  virtual ~Watchdog() {}
  virtual void feed() = 0;
};

class Led {
 public:
  virtual ~Led() {}
  virtual void set(const std::string &name) = 0;  // see device.cpp LED_COLORS
};

const long long VERSION_EVERY = 10000;  // settings version check (spec: ~10 s)
const long long UPDATE_EVERY = 30000;   // combined update (spec: ~30 s)
const long long LIVE_EVERY = 10000;     // combined update while a live game is on screen
const long long RADAR_EVERY = 3000;     // one missing radar frame per run
const long long LOGO_EVERY = 3000;      // one missing team logo per run
const int FAILS_BEFORE_RECONNECT = 3;
const long long HEALTH_EVERY = 60000;  // ms between health snapshots sent with the version check
const long long RETRY_WIFI_MS[] = {10000, 20000, 30000, 60000};  // waits between rounds, then every minute

struct Stats {
  long fetches = 0, forced = 0, draws = 0, fails = 0, reconnects = 0;
};

class Board {
 public:
  Board(Net *net, Display *display, Clock *clock, Networks networks, Buttons *buttons = nullptr,
        Watchdog *watchdog = nullptr, std::function<void(const std::string &)> log = nullptr,
        std::string started = "", std::string crash = "", Led *led = nullptr, Knob *knob = nullptr);

  Net *net;
  Display *display;
  Clock *clock;
  Networks networks;
  Buttons *buttons;
  Watchdog *watchdog;
  Led *led;
  Knob *knob;
  std::function<void(const std::string &)> log;
  std::function<long()> mem_free;       // bytes free, for health reports
  std::function<long()> largest_block;  // largest allocatable block
  std::function<void(const std::string &)> on_status;  // tests: every status screen shown

  player::Player player;
  control::ScreenOverride override_;
  control::Chooser chooser;
  sched::Scheduler sched;
  sched::Job version_job, update_job, radar_job, logo_job;
  Stats stats;
  long long epoch_ms = 0, sync_ms = 0;
  bool synced = false;
  int fails = 0;
  bool online = false;
  std::string last_error;  // '<job>:<reason>' of the latest failure
  std::string started, crash;
  std::string hardware, firmware;  // health: `hd` board model, `hv` build (contract: /board/version)
  std::string led_base = "connecting";

  long long now_ms(long long ms) const { return epoch_ms + (ms - sync_ms); }
  long long now(long long ms) const { return draw::fdiv(now_ms(ms), 1000); }  // epoch seconds

  void connect(bool boot = true);
  void step();
  std::string health_query(long long ms);

 private:
  control::Debounce up_, down_;
  long long last_draw_ = -1;
  std::optional<std::string> last_key_;
  std::string health_q_;
  std::optional<long long> health_at_;
  long long run_start_;
  std::string job_err_;

  void sync(double server_now, long long started, long long ended);
  void status(const std::string &kind, const std::string &detail = "");
  void wait(long long ms_total);
  void apply(const Value &p, long long started, long long ms);
  bool draw_frame(long long ms, long long now);
  sched::Result do_version(double ms);
  sched::Result do_update(double ms);
  sched::Result do_logo(double ms);
  sched::Result do_radar(double ms);
  void fetching();
  void led_update();
  void do_buttons(long long ms);
  void do_knob(long long ms);
  void commit_choice(long long ms);
  void say(const std::string &s) {
    if (log) log(s);
  }
};

}  // namespace app
