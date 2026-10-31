// CTA LED board firmware for the Adafruit Matrix Portal S3.
// See ../README.md for setup. The code is in src/; this file only wires it up.

#include <Arduino.h>

#include "src/app.h"
#include "src/calibrate.h"
#include "src/config.h"
#include "src/control.h"
#include "src/device.h"
#include "src/ota.h"

// Settings (WiFi, server, board ID, token, panel tuning) live in the board's
// flash (src/config.h). A build with secrets.h is a setup build: flashed over
// USB, it saves its settings to flash. A build without it is the generic
// build that OTA updates install on every board; it uses what's in flash.
#if __has_include("secrets.h")
#include "secrets.h"
#define SETUP_BUILD 1
#define BUILD_KIND "setup"
#else
#define SETUP_BUILD 0
#define BUILD_KIND "generic"
#endif

// The build's commit, written by `node scripts/stamp-firmware-version.js`
// (gitignored). Unstamped builds report "dev".
#if __has_include("version.h")
#include "version.h"
#endif
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "dev"
#endif

// The server reads this from an uploaded build to learn its version and
// that it's a generic build (contract: "Firmware"). Keep the format.
const char BUILD_MARK[] = "CTABOARD-BUILD:" FIRMWARE_VERSION ":" BUILD_KIND ";";

// Settings added after the first secrets.h, or left out of a short one (the
// control page's key block): defaults. BOARD_ID and BOARD_TOKEN have none.
#ifndef BOARD_URL
#define BOARD_URL "https://ctamap.fly.dev"
#endif
#ifndef WIFI_NETWORKS
#define WIFI_NETWORKS {}  // none: WiFi is entered on the board's setup network
#endif
#ifndef MATRIX_ROTATION
#define MATRIX_ROTATION 0
#endif
#ifndef MATRIX_CLK_PHASE
#define MATRIX_CLK_PHASE 0
#endif
#ifndef MATRIX_DOUBLE_BUFFER
#define MATRIX_DOUBLE_BUFFER 1
#endif
#ifndef MATRIX_CURVE
#define MATRIX_CURVE 2  // CircuitPython look (src/color.h)
#endif
#ifndef MATRIX_CALIBRATE
#define MATRIX_CALIBRATE 0
#endif
#ifndef MATRIX_NIGHT_CURVE
#define MATRIX_NIGHT_CURVE 3  // gamma 2.6
#endif
#ifndef MATRIX_HW_DIM
#define MATRIX_HW_DIM 1
#endif
#ifndef MATRIX_COLOR_ORDER
#define MATRIX_COLOR_ORDER "RGB"
#endif
#ifndef KNOB_REVERSE
#define KNOB_REVERSE 0
#endif
#ifndef STATUS_LED
#define STATUS_LED 2
#endif
#ifndef TLS_VERIFY
#define TLS_VERIFY 1
#endif
#ifndef SETUP_NAME
#define SETUP_NAME ""  // the setup network: "" for Board-<last 4 hex of the MAC>
#endif
#ifndef SETUP_PASSWORD
#define SETUP_PASSWORD ""  // 8+ characters for WPA2; "" for an open setup network
#endif

// The loop task's stack (Arduino's default is 8 KB): payload parsing and
// the transit view are a few levels deep.
#ifdef SET_LOOP_TASK_STACK_SIZE
SET_LOOP_TASK_STACK_SIZE(16 * 1024);
#endif

static config::Config cfg;
static device::Settings settings;
static device::Panel *panel;
static device::WifiNet *net;
static device::SysClock sys_clock;
static device::Buttons *buttons;
static device::Knob *knob;
static device::Watchdog *watchdog;
static device::StatusLed *led;
static device::Ota *ota_slot;
static device::SetupPortal *portal;
static app::Board *board;
static long long last_report = 0;
static bool no_setup = false;

#if SETUP_BUILD
// secrets.h as settings.
static config::Config built_config() {
  config::Config c;
  c.networks = WIFI_NETWORKS;
  c.url = BOARD_URL;
  c.board_id = BOARD_ID;
  c.token = BOARD_TOKEN;
  c.rotation = MATRIX_ROTATION;
  c.curve = MATRIX_CURVE;
  c.night_curve = MATRIX_NIGHT_CURVE;
  c.hw_dim = MATRIX_HW_DIM;
  c.status_led = STATUS_LED;
  c.tls_verify = TLS_VERIFY;
  c.clk_phase = MATRIX_CLK_PHASE;
  c.double_buffer = MATRIX_DOUBLE_BUFFER;
  c.color_order = MATRIX_COLOR_ORDER;
  c.knob_reverse = KNOB_REVERSE;
  c.setup_name = SETUP_NAME;
  c.setup_pass = SETUP_PASSWORD;
  return c;
}
#endif

// Settings from flash, or from secrets.h in a setup build (saved to flash
// when they changed). Sets no_setup when there are none.
static void load_settings() {
  const config::Config *built = nullptr;
#if SETUP_BUILD
  static config::Config b = built_config();
  built = &b;
#endif
  config::Choice ch = config::choose(built, device::nvs_get("cfg"), device::nvs_get("seed"));
  if (ch.write) {
    bool ok = device::nvs_put("cfg", config::to_json(ch.cfg)) && device::nvs_put("seed", ch.seed);
    Serial.println(ok ? "[setup] settings from secrets.h saved to flash" : "[setup] couldn't save settings to flash");
  }
  if (ch.source == config::NONE) {
    Serial.printf("[setup] no settings (%s): flash a setup build once over USB (README, \"Setting up\")\n",
                  ch.why.c_str());
    no_setup = true;
  } else {
    Serial.printf("[setup] board %s, %d networks, settings from %s\n", ch.cfg.board_id.c_str(),
                  (int)ch.cfg.networks.size(), ch.source == config::FROM_BUILD ? "secrets.h" : "flash");
  }
  cfg = ch.cfg;
  settings = device::settings_from(cfg);
}

void setup() {
  Serial.begin(115200);
  delay(500);  // let USB serial come up so the first lines aren't lost

  std::string started = device::start_reason();
  Serial.printf("[board] Matrix Portal S3, firmware %s (%s build), started by %s\n", FIRMWARE_VERSION, BUILD_KIND,
                started.c_str());
  Serial.printf("[board] %s\n", BUILD_MARK);
  load_settings();

  // A build on trial (OTA, src/ota.h) that keeps restarting goes back to
  // the previous one before anything else can crash it again.
  ota_slot = new device::Ota(FIRMWARE_VERSION);
  Serial.printf("[ota] running from %s\n", ota_slot->slot().c_str());
  if (ota_slot->boot() == ota::ROLL_BACK) ota_slot->roll_back("crashloop");  // restarts

  led = new device::StatusLed(settings.status_led);
  if (started == "WATCHDOG") {
    led->set("watchdog");  // white for a moment: the loop hung last time
    delay(2000);
  } else if (started == "PANIC") {
    led->set("crash");  // red for a moment: it crashed last time
    delay(2000);
  }

  panel = new device::Panel(settings);
  if (!panel->begin()) Serial.println("[board] panel init failed");
  Serial.printf("[board] panel refresh %d Hz (clock phase %d, double buffer %d, colors %s)\n", panel->refresh_rate(),
                (int)settings.clk_phase, (int)settings.double_buffer, settings.color_order.c_str());

  if (no_setup) {
    panel->show([&](draw::Frame &f) { draw::render_status(f, "nosetup", ""); });
    return;
  }

  if (MATRIX_CALIBRATE) {
    // Color calibration: no WiFi, just the pattern. UP: next curve; DOWN:
    // day / night by scaling / night in hardware. Put your picks in
    // MATRIX_CURVE, MATRIX_NIGHT_CURVE and MATRIX_HW_DIM.
    buttons = new device::Buttons();
    Serial.println("[calibrate] UP: next curve, DOWN: day / night scaled / night hardware");
    return;
  }

  watchdog = new device::Watchdog(16);
  net = new device::WifiNet(settings);
  net->feed = [] { watchdog->feed(); };
  buttons = new device::Buttons();
  // The knob (optional): turn to choose a screen, rest to switch.
  knob = new device::Knob(cfg.knob_reverse);
  knob->begin();

  // WiFi setup without USB (device.h SetupPortal): opens by itself with no
  // networks saved or none joined for 10 min; holding the knob (or UP) for
  // 2 s while the board starts opens it on demand.
  portal = new device::SetupPortal(&cfg, panel, [] { watchdog->feed(); });
  if (buttons->up() || knob->pressed()) {
    uint32_t t0 = millis();
    bool held = true;
    while (held && millis() - t0 < 2000) {
      watchdog->feed();
      delay(50);
      held = buttons->up() || knob->pressed();
    }
    if (held) portal->run("asked");  // restarts
  }

  board = new app::Board(net, panel, &sys_clock, settings.networks, buttons, watchdog,
                         [](const std::string &s) { Serial.println(s.c_str()); }, started,
                         started == "PANIC" ? "PANIC" : "", led, knob);
  board->hardware = "adafruit_matrixportal_s3";
  board->firmware = FIRMWARE_VERSION;
  board->ota = ota_slot;
  board->setup = portal;
  board->fresh_wifi = device::nvs_get("fresh") == "1";
  board->mem_free = device::free_heap;
  board->largest_block = device::largest_block;
  Serial.printf("[board] memory free %ld, largest block %ld\n", device::free_heap(), device::largest_block());

  board->connect(device::cold_boot());
  Serial.printf("[board] online: memory free %ld\n", device::free_heap());
  last_report = sys_clock.ms();
}

static void calibrate_loop() {
  static control::Debounce up, down;
  static int curve = MATRIX_CURVE, mode = calibrate::DAY;
  static bool first = true;
  long long ms = sys_clock.ms();
  bool u = up.update(buttons->up(), (double)ms), d = down.update(buttons->down(), (double)ms);
  if (u) curve = (curve + 1) % color::N_CURVES;
  if (d) mode = (mode + 1) % calibrate::N_MODES;
  if (u || d || first) {
    first = false;
    panel->set_curves(curve, curve);
    panel->dim(mode == calibrate::DAY ? 1.0 : 0.4, mode == calibrate::NIGHT_HARDWARE);
    panel->show([&](draw::Frame &f) { calibrate::draw_pattern(f, curve, mode); });
    Serial.printf("[calibrate] curve %d: %s; %s\n", curve, color::curve_name(curve), calibrate::mode_name(mode));
  }
  delay(10);
}

void loop() {
  if (no_setup) {
    // Nothing to connect with; a setup build flashed over USB fixes it.
    static uint32_t said = 0;
    if (millis() - said > 30000) {
      said = millis();
      Serial.println("[setup] no settings in flash: flash a setup build (with secrets.h) once over USB");
    }
    delay(100);
    return;
  }
  if (MATRIX_CALIBRATE) {
    calibrate_loop();
    return;
  }
  board->step();
  long long ms = sys_clock.ms();
  if (ms - last_report > 60000) {
    const app::Stats &st = board->stats;
    Serial.printf(
        "[board] fetch budget %d ms, draw %ld ms (max %ld), fetches %ld, forced %ld, draws %ld, fails %ld, "
        "reconnects %ld, mem free %ld, largest block %ld, chip %.1f C\n",
        (int)board->sched.budget_ms, panel->last_ms, panel->max_ms, st.fetches, st.forced, st.draws, st.fails,
        st.reconnects, device::free_heap(), device::largest_block(), device::chip_temp_c());
    panel->max_ms = 0;
    last_report = ms;
  }
  delay(5);
}
