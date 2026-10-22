// CTA LED board firmware for the Adafruit Matrix Portal S3.
// See ../README.md for setup. The code is in src/; this file only wires it up.

#include <Arduino.h>

#include "src/app.h"
#include "src/calibrate.h"
#include "src/control.h"
#include "src/device.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h (in this folder) and fill it in. See README.md."
#endif

// Settings added after the first secrets.h: defaults for older copies.
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

// The loop task's stack (Arduino's default is 8 KB): payload parsing and
// the transit view are a few levels deep.
#ifdef SET_LOOP_TASK_STACK_SIZE
SET_LOOP_TASK_STACK_SIZE(16 * 1024);
#endif

static device::Settings settings;
static device::Panel *panel;
static device::WifiNet *net;
static device::SysClock sys_clock;
static device::Buttons *buttons;
static device::Watchdog *watchdog;
static device::StatusLed *led;
static app::Board *board;
static long long last_report = 0;

void setup() {
  Serial.begin(115200);
  delay(500);  // let USB serial come up so the first lines aren't lost

  settings.networks = WIFI_NETWORKS;
  settings.url = BOARD_URL;
  settings.board_id = BOARD_ID;
  settings.token = BOARD_TOKEN;
  settings.rotation = MATRIX_ROTATION;
  settings.curve = MATRIX_CURVE;
  settings.night_curve = MATRIX_NIGHT_CURVE;
  settings.hw_dim = MATRIX_HW_DIM;
  settings.status_led = STATUS_LED;
  settings.tls_verify = TLS_VERIFY;
  settings.clk_phase = MATRIX_CLK_PHASE;
  settings.double_buffer = MATRIX_DOUBLE_BUFFER;

  std::string started = device::start_reason();
  Serial.printf("[board] Matrix Portal S3, started by %s\n", started.c_str());

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
  Serial.printf("[board] panel refresh %d Hz (clock phase %d, double buffer %d)\n", panel->refresh_rate(),
                MATRIX_CLK_PHASE, MATRIX_DOUBLE_BUFFER);

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

  board = new app::Board(net, panel, &sys_clock, settings.networks, buttons, watchdog,
                         [](const std::string &s) { Serial.println(s.c_str()); }, started,
                         started == "PANIC" ? "PANIC" : "", led);
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
        "reconnects %ld, mem free %ld, largest block %ld\n",
        (int)board->sched.budget_ms, panel->last_ms, panel->max_ms, st.fetches, st.forced, st.draws, st.fails,
        st.reconnects, device::free_heap(), device::largest_block());
    panel->max_ms = 0;
    last_report = ms;
  }
  delay(5);
}
