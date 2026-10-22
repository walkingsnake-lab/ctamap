// CTA LED board firmware for the Adafruit Matrix Portal S3.
// See ../README.md for setup. The code is in src/; this file only wires it up.

#include <Arduino.h>

#include "src/app.h"
#include "src/device.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h (in this folder) and fill it in. See README.md."
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
  settings.gamma = MATRIX_GAMMA;
  settings.status_led = STATUS_LED;
  settings.tls_verify = TLS_VERIFY;

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
  Serial.printf("[board] panel refresh %d Hz\n", panel->refresh_rate());

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

void loop() {
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
