// The board's main loop: connects, keeps the payload fresh, and draws.
// A port of firmware/boardlib/app.py (Board).
//
// Board takes its hardware as interfaces so the whole loop runs natively
// against a fake network and clock (firmware-s3/tests/app_test.cpp):
//   Net      - connect / version / update / radar / logo; false on failure
//   Display  - show(fn): fn fills a fresh frame, then it's shown
//   Clock    - ms(): monotonic milliseconds; sleep_ms()
//   Buttons, Knob, Watchdog, Led, Ota - optional
//   Worker   - runs requests off the draw loop (the S3's other core), so
//              animations never pause for the network. Without one (its
//              task couldn't start), requests block the loop.
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
#include "light.h"
#include "ota.h"
#include "player.h"
#include "sched.h"

namespace app {

using json::Value;
using screen::Screen;
using Networks = std::vector<std::pair<std::string, std::string>>;  // (ssid, password), tried in order
using StatusFn = std::function<void(const std::string &kind, const std::string &detail)>;

// A build the server offers (/board/version `fw`, contract).
struct FirmwareOffer {
  std::string v;     // the build's version (short commit)
  long long size = 0;
  std::string sha;   // SHA-256, lowercase hex
  long retry = 0;    // bumped by the control page's "Try again"
  std::string sig;   // ECDSA P-256 signature of the build (hex DER); checked against src/signing_key.h
};

using ChunkFn = std::function<bool(const uint8_t *data, size_t n)>;  // false: stop

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
  // A cloud strip for the skyline face (/board/sky/<id>): 1664 bytes.
  virtual bool sky(const std::string &id, std::vector<uint8_t> &out, std::string &err) {
    (void)id;
    (void)out;
    err = "Unsupported";
    return false;
  }
  // The knob chose a category (/board/select): out is the update for its screen.
  virtual bool select(const std::string &category, Value &out, std::string &err) {
    (void)category;
    (void)out;
    err = "Unsupported";
    return false;
  }
  virtual bool rssi(int &out) { (void)out; return false; }
  // Streams build `v` (exactly `size` bytes) to chunk, in order.
  virtual bool firmware(const std::string &v, long long size, const ChunkFn &chunk, std::string &err) {
    (void)v;
    (void)size;
    (void)chunk;
    err = "Unsupported";
    return false;
  }
};

class Display {
 public:
  virtual ~Display() {}
  virtual void show(const std::function<void(draw::Frame &)> &fn) = 0;
  // Brightness k (0-1). Returns the share the renderer scales colors by:
  // 1 when the display dims it all in hardware, k when it can't dim at all,
  // or between (color::hw_dim: hardware down to a floor, then the colors).
  virtual double set_brightness(double k) { return k; }
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

// The light sensor (device::LightSensor): lux, false when it can't be read.
class Light {
 public:
  virtual ~Light() {}
  virtual bool read(double &lux) = 0;
};

class Watchdog {
 public:
  virtual ~Watchdog() {}
  virtual void feed() = 0;
};

// Writes a downloaded build into the unused app slot and runs the trial
// (ota.h). On the board: device::Ota.
class Ota {
 public:
  virtual ~Ota() {}
  virtual bool begin(long long size, std::string &err) = 0;
  virtual bool write(const uint8_t *data, size_t n) = 0;
  // Checks the SHA-256, makes the new slot the boot slot, and starts its trial.
  virtual bool finish(const FirmwareOffer &offer, std::string &err) = 0;
  virtual void abort() = 0;
  virtual void restart() = 0;
  virtual std::string trial() = 0;  // the build on trial, "" if none
  virtual std::string bad() = 0;    // ota::mark of the last rolled-back offer
  virtual void keep() = 0;          // the build on trial proved itself
  virtual void roll_back(const std::string &why) = 0;  // back to the previous slot (restarts)
  virtual bool can_verify() { return true; }  // a signing key is built in (else nothing is installed)
};

// The board's own setup network and page (WiFi setup without USB). On the
// board: device::SetupPortal, whose run() restarts the board when it's done.
class Setup {
 public:
  virtual ~Setup() {}
  // why: "nowifi" (none saved, or none joined for SETUP_AFTER_MS),
  // "badwifi" (the network just entered didn't join), "asked" (held at power-on).
  virtual void run(const std::string &why) = 0;
  virtual void joined() {}  // online: a network entered on the page worked
};

// Runs one piece of network work at a time off the draw loop. start() hands
// it over (only when the last one is done); done() turns true once it has
// finished, and everything the work wrote is then safe to read. On the
// board: device::NetWorker, a task on core 0.
class Worker {
 public:
  virtual ~Worker() {}
  virtual void start(std::function<void()> work) = 0;
  virtual bool done() = 0;
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
const long long SKY_EVERY = 3000;       // the skyline's cloud strip, when the payload names a new one
// What this firmware draws beyond the original screens (health `hk`, contract):
// the server sends the clock screen only to boards that report `skyline`,
// and each other face only to those that also report it.
const char *const CAPS = "skyline:seventies:analog:daynight:gradient";
const int FAILS_BEFORE_RECONNECT = 3;
const long long SETUP_AFTER_MS = 600000;  // no network joined this long: open the setup network
const long long HEALTH_EVERY = 60000;  // ms between health snapshots sent with the version check
const long long WORK_STUCK_MS = 45000;  // a request running this long: stop feeding the watchdog (it resets the board)
const long long RETRY_WIFI_MS[] = {10000, 20000, 30000, 60000};  // waits between rounds, then every minute

struct Stats {
  long fetches = 0, draws = 0, fails = 0, reconnects = 0;
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
  Ota *ota = nullptr;  // OTA updates (set after construction); none: offers are ignored
  Setup *setup = nullptr;  // WiFi setup network; none: keep retrying forever
  Light *light = nullptr;  // light sensor (set after construction); none: the payload's brightness

  Worker *worker = nullptr;  // requests off the draw loop (set after construction); none: they block it
  bool fresh_wifi = false;  // the first network was just entered on the setup page
  std::function<void(const std::string &)> log;
  std::function<long()> mem_free;       // bytes free, for health reports
  std::function<long()> largest_block;  // largest allocatable block
  std::function<void(const std::string &)> on_status;  // tests: every status screen shown

  player::Player player;
  control::ScreenOverride override_;
  control::Chooser chooser;
  sched::Scheduler sched;
  sched::Job version_job, update_job, radar_job, logo_job, sky_job;
  Stats stats;
  long long epoch_ms = 0, sync_ms = 0;
  bool synced = false;
  int fails = 0;
  bool online = false;
  std::string last_error;  // '<job>:<reason>' of the latest failure
  std::string started, crash;
  std::string hardware, firmware;  // health: `hd` board model, `hv` build (contract: /board/version)
  std::string led_base = "connecting";

  std::optional<FirmwareOffer> offer;  // the build the server offers, from the last version check
  bool reached_server = false;         // a good update this run (the trial's test)

  long long now_ms(long long ms) const { return epoch_ms + (ms - sync_ms); }
  long long now(long long ms) const { return draw::fdiv(now_ms(ms), 1000); }  // epoch seconds

  void connect(bool boot = true);
  void step();
  bool in_flight() const { return flight_.has_value(); }
  bool sliding(long long ms) const { return trans_ == SLIDE && ms - trans_start_ < slide_ms_; }
  double slide_ms() const { return slide_ms_; }
  long long trans_start() const { return trans_start_; }
  bool fading(long long ms) const { return trans_ == FADE && ms - trans_start_ < draw::SCREEN_FADE_MS; }
  bool transitioning(long long ms) const { return sliding(ms) || fading(ms); }
  int slide_dir() const { return slide_dir_; }
  std::string health_query(long long ms);

 private:
  control::Debounce up_, down_;
  long long last_draw_ = -1;
  std::optional<screen::FrameKey> last_key_;
  std::string health_q_;
  std::optional<long long> health_at_;
  long long run_start_;
  std::string job_err_;
  long long install_after_ = 0;           // ms: next install attempt allowed
  std::optional<long long> wanted_since_;  // ms: when the current offer first wanted installing
  std::string ota_err_;                    // the last failed install this run

  // Brightness (light.h): the payload's level, or with `ab` and a live
  // sensor, the sensor's level between ab.min and 100.
  double payload_bright_ = 100;
  std::optional<double> ab_min_;
  light::Sense sense_;
  light::Fade fade_;
  std::optional<double> applied_;   // percent last sent to the display
  long long light_read_ = -1000000;  // ms of the last sensor reading
  void do_light(long long ms);
  void apply_bright(long long ms);

  // A request on its way: work() runs on the worker (network calls only,
  // into this struct); land() then finishes it on the loop.
  struct Flight {
    sched::Job *job = nullptr;  // null: the knob's select
    long long started = 0;
    std::function<bool()> work;
    std::function<sched::Result(long long ended)> finish;  // after a good work()
    bool ok = false;
    std::string err;
    std::string id;     // radar frame / logo id, or the knob's category
    int left = 0;       // more of a set still missing after this one
    Value v;            // JSON answer
    std::vector<uint8_t> bytes;  // binary answer
  };
  std::optional<Flight> flight_;
  sched::Job *pending_job_ = nullptr;  // the job whose run() is launching
  long long pending_start_ = 0;
  bool stuck_said_ = false;

  // Screen-change transition: the last frame shown and what it showed (a
  // Screen, or one of these); a change of that slides (knob, buttons) or
  // fades (anything else) the new screen in over a copy of it.
  static const int SHOWN_NONE = -1, SHOWN_STATUS = -2, SHOWN_CHOOSER = -3;
  static constexpr double SCREEN_SLIDE_QUICK_MS = 250;  // a slide that interrupts a running one
  enum Trans { NO_TRANS, SLIDE, FADE };
  uint8_t last_px_[draw::Frame::W * draw::Frame::H * 3] = {};
  uint8_t slide_px_[draw::Frame::W * draw::Frame::H * 3] = {};
  int shown_ = SHOWN_NONE;
  Trans trans_ = NO_TRANS;
  long long trans_start_ = -1;
  int slide_dir_ = 1;
  double slide_ms_ = draw::SCREEN_SLIDE_MS;  // this slide's length (quicker when it interrupts one)
  long long chooser_travel_ = 0;  // where the knob's last turn went (ring steps, + clockwise)
  int button_dir_ = 0;            // a button press waiting for its frame: -1 UP, +1 DOWN
  void shown(int what, long long ms);
  void launch(Flight f);
  void land(long long ended);

  bool wants_install() const;
  void maybe_install(long long ms, bool busy);
  void install();
  void trial_check(long long ms);
  std::string ota_health() const;

  void sync(double server_now, long long started, long long ended);
  void status(const std::string &kind, const std::string &detail = "");
  void wait(long long ms_total);
  void apply(const Value &p, long long started, long long ms);
  bool draw_frame(long long ms, long long now);
  // Each job either skips (nothing to fetch) or launches a Flight.
  sched::Result do_version(double ms);
  sched::Result do_update(double ms);
  sched::Result do_logo(double ms);
  sched::Result do_radar(double ms);
  sched::Result do_sky(double ms);
  sched::Result after_job(Flight &f, sched::Result r, long long ended);
  void after_select(Flight &f, long long ended);
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
