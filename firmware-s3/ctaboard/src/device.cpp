// Matrix Portal S3 hardware; see device.h.

#ifdef ARDUINO

#include "device.h"

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_arduino_version.h>
#include <esp_heap_caps.h>
#include <esp_idf_version.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <math.h>

#include <algorithm>

#include "certs.h"

namespace device {

// ---- pins (Matrix Portal S3; from CircuitPython's adafruit_matrixportal_s3 board) ----

// k-prefixed: the Arduino core defines B1 (binary.h), and board variants
// define names like BUTTON_UP and NEOPIXEL as macros.
static const int8_t kR1 = 42, kG1 = 41, kB1 = 40, kR2 = 38, kG2 = 39, kB2 = 37;
static const int8_t kA = 45, kB = 36, kC = 48, kD = 35, kE = 21;
static const int8_t kLat = 47, kOe = 14, kClk = 2;
static const int kButtonUp = 6, kButtonDown = 7;
static const int kNeoPixel = 4;

// ---- panel ----

Panel::Panel(const Settings &s)
    : rotation_(s.rotation), pipe_(s.curve), day_curve_(s.curve), night_curve_(s.night_curve), hw_dim_(s.hw_dim),
      clk_phase_(s.clk_phase), double_buffer_(s.double_buffer) {}

void Panel::set_curves(int day, int night) {
  day_curve_ = day;
  night_curve_ = night;
}

bool Panel::set_brightness(double k) {
  dim(k, hw_dim_);
  return hw_dim_;
}

void Panel::dim(double k, bool hw) {
  int curve = k < 1 ? night_curve_ : day_curve_;
  if (curve != pipe_.curve()) pipe_.set_curve(curve);
  // In hardware, the driver shortens every row's lit window by the same
  // fraction for every color bit, so colors keep all their steps. The level
  // matches the light the renderer's scaling gave under gamma 2.2 (k^2.2:
  // 40% is about 13% of full), so night stays as dark as it was.
  int oe = 255;
  if (hw) {
    oe = (int)floor(pow(k, 2.2) * 255 + 0.5);
    if (k > 0 && oe < 1) oe = 1;
  }
  if (oe != oe_ && dma_) {
    dma_->setBrightness8((uint8_t)oe);
    oe_ = oe;
  }
}

bool Panel::begin() {
  HUB75_I2S_CFG::i2s_pins pins = {kR1, kG1, kB1, kR2, kG2, kB2, kA, kB, kC, kD, kE, kLat, kOe, kClk};
  HUB75_I2S_CFG cfg(64, 32, 1, pins);
  cfg.double_buff = double_buffer_;  // draw into the back buffer, then flip: no half-drawn frames
  cfg.clkphase = clk_phase_;
  dma_ = new MatrixPanel_I2S_DMA(cfg);
  if (!dma_->begin()) return false;
  dma_->setBrightness8((uint8_t)oe_);  // full until the first payload's brightness
  dma_->clearScreen();
  if (double_buffer_) {
    dma_->flipDMABuffer();
    delay(20);
    dma_->clearScreen();
    flipped_at_ = esp_timer_get_time();
  }
  return true;
}

int Panel::refresh_rate() const { return dma_ ? dma_->calculated_refresh_rate : 0; }

void Panel::show(const std::function<void(draw::Frame &)> &fn) {
  if (double_buffer_) {
    // A flip takes effect at the end of the panel's current refresh. Until
    // then the buffer we'd draw into next is still on screen, and drawing
    // into it shows as flickering stray pixels: wait out one refresh since
    // the last flip (the driver's double-buffer example does the same).
    int rate = dma_->calculated_refresh_rate > 0 ? dma_->calculated_refresh_rate : 60;
    int64_t period = 1000000 / rate + 1000;
    int64_t since = esp_timer_get_time() - flipped_at_;
    if (since < period) delayMicroseconds((uint32_t)(period - since));
  }
  int64_t t0 = esp_timer_get_time();
  frame_.clear();
  fn(frame_);
  const uint8_t *px = frame_.px;
  for (int y = 0; y < 32; y++) {
    for (int x = 0; x < 64; x++) {
      int i = (y * 64 + x) * 3;
      uint8_t r = px[i], g = px[i + 1], b = px[i + 2];
      pipe_.map(r, g, b);  // the chosen curve, compensated for the driver's own (color.h)
      int dx = rotation_ == 180 ? 63 - x : x;
      int dy = rotation_ == 180 ? 31 - y : y;
      dma_->drawPixelRGB888(dx, dy, r, g, b);
    }
  }
  if (double_buffer_) {
    dma_->flipDMABuffer();
    flipped_at_ = esp_timer_get_time();
  }
  last_ms = (long)((esp_timer_get_time() - t0) / 1000);
  if (last_ms > max_ms) max_ms = last_ms;
}

// ---- network ----

static const int JOIN_TRIES = 2;        // attempts per network before moving on
static const int JOIN_TIMEOUT_MS = 10000;
static const int JOIN_PAUSE_MS = 2000;  // after a failed ping on a fresh join (DHCP/DNS settling)
// Connect (TLS included) plus read stay under the 16 s watchdog.
static const int HTTP_CONNECT_MS = 5000;
static const int HTTP_TIMEOUT_MS = 8000;

WifiNet::WifiNet(const Settings &s) : s_(s) {
  WiFi.persistent(false);  // don't write credentials to flash on every join
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);    // lower request latency
}

std::string WifiNet::mac() const {
  std::string m = WiFi.macAddress().c_str();
  for (char &c : m)
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
  return m;
}

bool WifiNet::rssi(int &out) {
  if (WiFi.status() != WL_CONNECTED) return false;
  out = WiFi.RSSI();
  return true;
}

void WifiNet::reset_radio(const char *why) {
  Serial.printf("[wifi] resetting radio: %s\n", why);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
}

bool WifiNet::join(const std::string &ssid, const std::string &password, const app::StatusFn &status) {
  // A few tries per network (a hotspot can drop out now and then). Always
  // disconnects first so a failed join doesn't stick.
  for (int attempt = 0; attempt < JOIN_TRIES; attempt++) {
    status("connecting", ssid);
    WiFi.disconnect();
    delay(100);
    WiFi.begin(ssid.c_str(), password.c_str());
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < (uint32_t)JOIN_TIMEOUT_MS) {
      if (feed) feed();
      delay(100);
    }
    if (WiFi.status() == WL_CONNECTED) return true;
    Serial.printf("[wifi] %s: try %d/%d failed (status %d)\n", ssid.c_str(), attempt + 1, JOIN_TRIES, (int)WiFi.status());
  }
  return false;
}

app::ConnectResult WifiNet::connect(const app::Networks &networks, const app::StatusFn &status) {
  // Try each (ssid, password) in order, networks the radio can see first.
  // ok with the network's name, portal (with the MAC) if a network answered
  // with a captive portal, or nowifi.
  if (WiFi.status() == WL_CONNECTED) {
    std::string cur = WiFi.SSID().c_str();
    for (const auto &n : networks)
      if (n.first == cur && ping()) {
        Serial.printf("[wifi] %s: still connected\n", cur.c_str());
        return {"ok", cur};
      }
  }
  status("connecting", "");
  int found = WiFi.scanNetworks();
  std::vector<std::string> seen;
  for (int i = 0; i < found; i++) {
    std::string name = WiFi.SSID(i).c_str();
    for (const auto &n : networks)
      if (n.first == name && std::find(seen.begin(), seen.end(), name) == seen.end()) seen.push_back(name);
  }
  WiFi.scanDelete();
  Serial.printf("[wifi] %d networks, ours: %d\n", found, (int)seen.size());
  app::Networks order;
  for (const auto &n : networks)
    if (std::find(seen.begin(), seen.end(), n.first) != seen.end()) order.push_back(n);
  for (const auto &n : networks)
    if (std::find(seen.begin(), seen.end(), n.first) == seen.end()) order.push_back(n);
  bool portal = false;
  for (const auto &n : order) {
    if (!join(n.first, n.second, status)) continue;
    if (ping()) return {"ok", n.first};
    delay(JOIN_PAUSE_MS);
    if (ping()) return {"ok", n.first};
    portal = true;
    Serial.printf("[wifi] %s: joined, but /board/ping failed (captive portal?)\n", n.first.c_str());
  }
  if (!portal) reset_radio("no network joined");
  return portal ? app::ConnectResult{"portal", mac()} : app::ConnectResult{"nowifi", ""};
}

// One GET. Fills body (JSON) or bytes (binary, exactly `size` of them).
static bool http_get(const Settings &s, const std::string &path, bool auth, std::string *body, size_t size,
                     std::vector<uint8_t> *bytes, std::string &err, const std::function<void()> &feed) {
  WiFiClientSecure client;
  if (s.tls_verify) client.setCACert(ROOT_CAS);
  else client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(HTTP_CONNECT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, (s.url + path).c_str())) {
    err = "Begin";
    return false;
  }
  if (auth && !s.token.empty()) http.addHeader("X-Board-Token", s.token.c_str());
  int code = http.GET();
  if (feed) feed();  // the body read gets its own watchdog period
  if (code != 200) {
    err = code < 0 ? "Conn" + std::to_string(-code) : "HTTP" + std::to_string(code);
    http.end();
    return false;
  }
  bool ok = true;
  if (body) {
    *body = http.getString().c_str();
  } else {
    int len = http.getSize();
    if (len != (int)size) {
      err = "Size" + std::to_string(len < 0 ? 0 : len);
      ok = false;
    } else {
      bytes->assign(size, 0);
      auto *stream = http.getStreamPtr();
      size_t got = 0;
      uint32_t start = millis();
      while (got < size && millis() - start < (uint32_t)HTTP_TIMEOUT_MS) {
        int n = stream->read(bytes->data() + got, size - got);
        if (n > 0) got += n;
        else delay(1);
      }
      if (got != size) {
        err = "Short";
        ok = false;
      }
    }
  }
  http.end();
  return ok;
}

bool WifiNet::get_json(const std::string &path, bool auth, json::Value &out, std::string &err) {
  if (feed) feed();
  std::string body;
  if (!http_get(s_, path, auth, &body, 0, nullptr, err, feed)) return false;
  std::string perr;
  if (!json::parse(body, out, &perr)) {
    err = "JSON";
    return false;
  }
  return true;
}

bool WifiNet::get_bytes(const std::string &path, size_t size, std::vector<uint8_t> &out, std::string &err) {
  if (feed) feed();
  return http_get(s_, path, true, nullptr, size, &out, err, feed);
}

bool WifiNet::ping() {
  // Our server answers {"ok":1}; anything else (HTML, a redirect) is a captive portal.
  json::Value v;
  std::string err;
  return get_json("/board/ping", false, v, err) && v["ok"].num() == 1;
}

bool WifiNet::version(const std::string &health, json::Value &out, std::string &err) {
  return get_json("/board/version?b=" + s_.board_id + health, true, out, err);
}

bool WifiNet::update(bool boot, const std::string &screen, json::Value &out, std::string &err) {
  return get_json("/board/update?b=" + s_.board_id + (boot ? "&boot=1" : "") + (screen.empty() ? "" : "&s=" + screen),
                  true, out, err);
}

bool WifiNet::radar(const std::string &id, std::vector<uint8_t> &out, std::string &err) {
  // Packed 4 bits a pixel (pk=4): 1024 bytes.
  return get_bytes("/board/radar/" + id + "?b=" + s_.board_id + "&pk=4", 1024, out, err);
}

bool WifiNet::logo(const std::string &id, std::vector<uint8_t> &out, std::string &err) {
  return get_bytes("/board/logo/" + id + "?b=" + s_.board_id, 24 * 12 * 3, out, err);
}

// ---- clock, buttons ----

long long SysClock::ms() { return esp_timer_get_time() / 1000; }
void SysClock::sleep_ms(long long ms) {
  if (ms > 0) delay((uint32_t)ms);
}

Buttons::Buttons() {
  pinMode(kButtonUp, INPUT_PULLUP);
  pinMode(kButtonDown, INPUT_PULLUP);
}
bool Buttons::up() { return digitalRead(kButtonUp) == LOW; }
bool Buttons::down() { return digitalRead(kButtonDown) == LOW; }

// ---- status LED ----
// Very dim: it sits behind the panel and shouldn't light up the wall at night.

struct LedColor {
  const char *name;
  uint8_t r, g, b;
};
static const LedColor LED_COLORS[] = {
    {"off", 0, 0, 0},
    {"fetch", 0, 0, 10},       // blue: a request is blocking the loop
    {"connecting", 8, 6, 0},   // yellow: joining WiFi
    {"portal", 10, 3, 0},      // amber: captive portal
    {"offline", 12, 0, 0},     // red: no WiFi, or the server isn't answering
    {"failing", 3, 0, 0},      // dim red: online, but the last request failed
    {"watchdog", 6, 6, 6},     // white, at startup: the last reset was the watchdog
    {"crash", 12, 0, 0},       // red: the last reset was a crash (panic)
};

StatusLed::StatusLed(int mode) : mode_(mode) { set("off"); }

void StatusLed::set(const std::string &name_in) {
  if (mode_ == 0) return;
  std::string name = mode_ < 2 && name_in == "fetch" ? "off" : name_in;
  if (name == state_) return;
  state_ = name;
  for (const LedColor &c : LED_COLORS)
    if (name == c.name) {
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
      rgbLedWrite(kNeoPixel, c.r, c.g, c.b);
#else
      neopixelWrite(kNeoPixel, c.r, c.g, c.b);
#endif
      return;
    }
}

// ---- watchdog ----
// Resets the board if the loop stops feeding it (a hung request). The loop
// feeds it every pass, and the network before each request, so one request
// gets the whole timeout.

Watchdog::Watchdog(int seconds) {
#if ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = (uint32_t)seconds * 1000;
  cfg.idle_core_mask = 0;
  cfg.trigger_panic = true;
  if (esp_task_wdt_reconfigure(&cfg) != ESP_OK) esp_task_wdt_init(&cfg);
#else
  esp_task_wdt_init(seconds, true);
#endif
  on_ = esp_task_wdt_add(NULL) == ESP_OK;
  if (!on_) Serial.println("[board] no watchdog");
}

void Watchdog::feed() {
  if (on_) esp_task_wdt_reset();
}

// ---- reset reason, memory ----

std::string start_reason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWER_ON";
    case ESP_RST_EXT: return "RESET_PIN";
    case ESP_RST_SW: return "SOFTWARE";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "WATCHDOG";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
#if ESP_IDF_VERSION_MAJOR >= 5
    case ESP_RST_USB: return "USB";
#endif
    default: return "UNKNOWN";
  }
}

bool cold_boot() {
  // After power-on or the RESET button, the server resets the brightness to
  // Auto (so a board left off comes back lit); not after a crash or a
  // watchdog reset.
  esp_reset_reason_t r = esp_reset_reason();
#if ESP_IDF_VERSION_MAJOR >= 5
  if (r == ESP_RST_USB) return true;
#endif
  return r == ESP_RST_POWERON || r == ESP_RST_EXT || r == ESP_RST_UNKNOWN;
}

long free_heap() { return (long)ESP.getFreeHeap(); }
long largest_block() { return (long)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT); }

float chip_temp_c() {
  // temperatureRead() (Arduino-ESP32) reads the S3's built-in sensor; single reads jitter by about 1 C.
  float sum = 0;
  for (int i = 0; i < 8; i++) sum += temperatureRead();
  return sum / 8;
}

}  // namespace device

#endif  // ARDUINO
