// Matrix Portal S3 hardware; see device.h.

#ifdef ARDUINO

#include "device.h"

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_arduino_version.h>
#include <esp_heap_caps.h>
#include <esp_idf_version.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <math.h>
#include <mbedtls/sha256.h>

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

// ---- settings ----

Settings settings_from(const config::Config &c) {
  Settings s;
  s.networks = c.networks;
  s.url = c.url;
  s.board_id = c.board_id;
  s.token = c.token;
  s.rotation = c.rotation;
  s.curve = c.curve;
  s.night_curve = c.night_curve;
  s.hw_dim = c.hw_dim;
  s.status_led = c.status_led;
  s.tls_verify = c.tls_verify;
  s.clk_phase = c.clk_phase;
  s.double_buffer = c.double_buffer;
  s.color_order = c.color_order;
  return s;
}

std::string nvs_get(const char *key) {
  Preferences p;
  if (!p.begin("ctaboard", true)) return "";  // read-only; fails when the namespace doesn't exist yet
  std::string v = p.isKey(key) ? p.getString(key, "").c_str() : "";
  p.end();
  return v;
}

bool nvs_put(const char *key, const std::string &value) {
  Preferences p;
  if (!p.begin("ctaboard", false)) return false;
  bool ok = p.putString(key, value.c_str()) == value.size();
  p.end();
  return ok;
}

// ---- panel ----

Panel::Panel(const Settings &s)
    : rotation_(s.rotation), pipe_(s.curve), day_curve_(s.curve), night_curve_(s.night_curve), hw_dim_(s.hw_dim),
      clk_phase_(s.clk_phase), double_buffer_(s.double_buffer), color_order_(s.color_order.empty() ? "RGB" : s.color_order) {}

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

// The data pins for red, green and blue, given which color each line (R, G, B) lights on the panel.
// An order that isn't R, G and B once each falls back to RGB.
static void color_pins(const std::string &order, const int8_t lines[3], int8_t out[3]) {
  static const char kColors[3] = {'R', 'G', 'B'};
  bool ok = order.size() == 3;
  for (int c = 0; ok && c < 3; c++) {
    size_t i = order.find(kColors[c]);
    if (i == std::string::npos) ok = false;
    else out[c] = lines[i];
  }
  if (!ok) {
    Serial.printf("[board] MATRIX_COLOR_ORDER \"%s\" isn't R, G and B once each; using RGB\n", order.c_str());
    for (int c = 0; c < 3; c++) out[c] = lines[c];
  }
}

bool Panel::begin() {
  const int8_t top[3] = {kR1, kG1, kB1}, bottom[3] = {kR2, kG2, kB2};
  int8_t t[3], b[3];
  color_pins(color_order_, top, t);
  color_pins(color_order_, bottom, b);
  HUB75_I2S_CFG::i2s_pins pins = {t[0], t[1], t[2], b[0], b[1], b[2], kA, kB, kC, kD, kE, kLat, kOe, kClk};
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
                     std::vector<uint8_t> *bytes, std::string &err, const std::function<void()> &feed,
                     bool post = false) {
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
  int code = post ? http.POST("") : http.GET();
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

bool WifiNet::firmware(const std::string &v, long long size, const app::ChunkFn &chunk, std::string &err) {
  // GET /board/firmware (contract): the build, streamed to chunk in 4 KB
  // pieces. A stall longer than HTTP_TIMEOUT_MS fails it; the watchdog is
  // fed after every piece, so the whole download may take longer.
  if (feed) feed();
  WiFiClientSecure client;
  if (s_.tls_verify) client.setCACert(ROOT_CAS);
  else client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(HTTP_CONNECT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  std::string path = "/board/firmware?b=" + s_.board_id + "&v=" + v;
  if (!http.begin(client, (s_.url + path).c_str())) {
    err = "Begin";
    return false;
  }
  if (!s_.token.empty()) http.addHeader("X-Board-Token", s_.token.c_str());
  int code = http.GET();
  if (feed) feed();
  if (code != 200) {
    err = code < 0 ? "Conn" + std::to_string(-code) : "HTTP" + std::to_string(code);
    http.end();
    return false;
  }
  if ((long long)http.getSize() != size) {
    err = "Size" + std::to_string(http.getSize() < 0 ? 0 : http.getSize());
    http.end();
    return false;
  }
  std::vector<uint8_t> buf(4096);
  auto *stream = http.getStreamPtr();
  long long got = 0;
  uint32_t last = millis();
  bool ok = true;
  while (got < size) {
    size_t want = (size_t)std::min<long long>((long long)buf.size(), size - got);
    int n = stream->read(buf.data(), want);
    if (n > 0) {
      got += n;
      last = millis();
      if (feed) feed();
      if (!chunk(buf.data(), (size_t)n)) {
        if (err.empty()) err = "Stopped";
        ok = false;
        break;
      }
    } else if (millis() - last > (uint32_t)HTTP_TIMEOUT_MS || !stream->connected()) {
      if (stream->available() > 0) continue;
      err = "Short";
      ok = false;
      break;
    } else {
      delay(1);
    }
  }
  http.end();
  return ok;
}

bool WifiNet::get_json(const std::string &path, bool auth, json::Value &out, std::string &err, bool post) {
  if (feed) feed();
  std::string body;
  if (!http_get(s_, path, auth, &body, 0, nullptr, err, feed, post)) return false;
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

bool WifiNet::select(const std::string &category, json::Value &out, std::string &err) {
  return get_json("/board/select?b=" + s_.board_id + "&s=" + category, true, out, err, true);
}

// ---- OTA ----

Ota::Ota(const std::string &running) : running_(running) { load(); }

Ota::~Ota() {
  if (sha_) {
    mbedtls_sha256_free((mbedtls_sha256_context *)sha_);
    delete (mbedtls_sha256_context *)sha_;
  }
}

void Ota::load() {
  Preferences p;
  if (!p.begin("ota", true)) return;  // never written
  st_.trial = p.getString("trial", "").c_str();
  st_.prev = p.getString("prev", "").c_str();
  st_.boots = p.getInt("boots", 0);
  st_.retry = p.getLong("retry", 0);
  st_.bad = p.getString("bad", "").c_str();
  p.end();
}

void Ota::save() {
  Preferences p;
  if (!p.begin("ota", false)) {
    Serial.println("[ota] can't save state");
    return;
  }
  p.putString("trial", st_.trial.c_str());
  p.putString("prev", st_.prev.c_str());
  p.putInt("boots", st_.boots);
  p.putLong("retry", st_.retry);
  p.putString("bad", st_.bad.c_str());
  p.end();
}

std::string Ota::slot() const {
  const esp_partition_t *p = esp_ota_get_running_partition();
  return p ? p->label : "?";
}

ota::BootAction Ota::boot() {
  bool had = !st_.trial.empty();
  ota::BootAction a = ota::on_boot(st_, running_);
  if (had || !st_.trial.empty()) save();
  if (!st_.trial.empty())
    Serial.printf("[ota] %s on trial in %s: start %d of %d\n", st_.trial.c_str(), slot().c_str(), st_.boots, ota::MAX_TRIAL_BOOTS);
  return a;
}

bool Ota::begin(long long size, std::string &err) {
  if (!esp_ota_get_next_update_partition(NULL)) {
    err = "NoSlot";  // a partition scheme without a second app slot
    return false;
  }
  if (!Update.begin((size_t)size, U_FLASH)) {
    err = "Begin" + std::to_string((int)Update.getError());
    return false;
  }
  if (!sha_) sha_ = new mbedtls_sha256_context;
  mbedtls_sha256_init((mbedtls_sha256_context *)sha_);
  mbedtls_sha256_starts((mbedtls_sha256_context *)sha_, 0);
  open_ = true;
  return true;
}

bool Ota::write(const uint8_t *data, size_t n) {
  if (!open_) return false;
  mbedtls_sha256_update((mbedtls_sha256_context *)sha_, data, n);
  return Update.write(const_cast<uint8_t *>(data), n) == n;
}

bool Ota::finish(const app::FirmwareOffer &offer, std::string &err) {
  if (!open_) {
    err = "NotOpen";
    return false;
  }
  uint8_t digest[32];
  mbedtls_sha256_finish((mbedtls_sha256_context *)sha_, digest);
  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  if (offer.sha != hex) {
    err = "SHA";
    return false;
  }
  std::string prev = slot();
  if (!Update.end(true)) {  // checks the image and makes its slot the boot slot
    err = "End" + std::to_string((int)Update.getError());
    open_ = false;
    return false;
  }
  open_ = false;
  st_.trial = offer.v;
  st_.prev = prev;
  st_.boots = 0;
  st_.retry = offer.retry;
  save();
  return true;
}

void Ota::abort() {
  if (open_) Update.abort();
  open_ = false;
}

void Ota::restart() {
  delay(200);
  ESP.restart();
}

void Ota::keep() {
  ota::kept(st_);
  save();
  esp_ota_mark_app_valid_cancel_rollback();  // in case the bootloader also checks (no-op otherwise)
}

void Ota::roll_back(const std::string &why) {
  std::string prev = st_.prev, trial = st_.trial;
  const esp_partition_t *p = prev.empty() ? nullptr
      : esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, prev.c_str());
  ota::rolled_back(st_);
  save();
  Serial.printf("[ota] rolling back %s (%s) to %s\n", trial.c_str(), why.c_str(), p ? prev.c_str() : "nothing");
  if (!p || esp_ota_set_boot_partition(p) != ESP_OK) {
    Serial.println("[ota] no previous build to go back to; keeping this one");
    return;
  }
  delay(200);
  ESP.restart();
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

// ---- knob ----
// The 5880's seesaw firmware at its default address, on the STEMMA QT port
// (Wire's default pins on this board). It counts detents itself, so clicks
// made while a request blocks the loop arrive afterwards, not lost.

static const uint8_t SEESAW_ADDR = 0x36;
static const uint8_t SEESAW_STATUS = 0x00, SEESAW_STATUS_HW_ID = 0x01;
static const uint8_t SEESAW_ENCODER = 0x11, SEESAW_ENCODER_DELTA = 0x40;
static const uint32_t KNOB_POLL_MS = 20;

bool Knob::read(uint8_t base, uint8_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(SEESAW_ADDR);
  Wire.write(base);
  Wire.write(reg);
  if (Wire.endTransmission() != 0) return false;
  delayMicroseconds(250);  // the seesaw needs a moment to prepare the reply
  if (Wire.requestFrom((int)SEESAW_ADDR, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = (uint8_t)Wire.read();
  return true;
}

bool Knob::begin() {
  Wire.begin();
  uint8_t id = 0;
  on_ = read(SEESAW_STATUS, SEESAW_STATUS_HW_ID, &id, 1);
  if (on_) {
    uint8_t d[4];
    read(SEESAW_ENCODER, SEESAW_ENCODER_DELTA, d, 4);  // drop turns from before startup
    Serial.printf("[knob] encoder found (seesaw id 0x%02x)\n", id);
  } else {
    Serial.println("[knob] no encoder on the STEMMA QT port");
  }
  return on_;
}

int Knob::clicks() {
  if (!on_) return 0;
  uint32_t now = millis();
  if (now - polled_ < KNOB_POLL_MS) return 0;
  polled_ = now;
  uint8_t d[4];
  if (!read(SEESAW_ENCODER, SEESAW_ENCODER_DELTA, d, 4)) return 0;
  int32_t delta = (int32_t)(((uint32_t)d[0] << 24) | ((uint32_t)d[1] << 16) | ((uint32_t)d[2] << 8) | d[3]);
  // The seesaw counts down clockwise; KNOB_REVERSE flips it.
  return reverse_ ? delta : -delta;
}

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
