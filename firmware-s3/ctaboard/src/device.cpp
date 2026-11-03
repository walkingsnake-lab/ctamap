// Matrix Portal S3 hardware; see device.h.

#ifdef ARDUINO

#include "device.h"

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
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
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

#include <algorithm>

#include "certs.h"
#include "signing_key.h"

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
    : rotation_(s.rotation), pipe_(s.curve), scene_pipe_(s.night_curve), day_curve_(s.curve), night_curve_(s.night_curve), hw_dim_(s.hw_dim),
      clk_phase_(s.clk_phase), double_buffer_(s.double_buffer), color_order_(s.color_order.empty() ? "RGB" : s.color_order) {}

void Panel::set_curves(int day, int night) {
  day_curve_ = day;
  night_curve_ = night;
  if (scene_pipe_.curve() != night) scene_pipe_.set_curve(night);
}

double Panel::set_brightness(double k) {
  return dim(k, hw_dim_);
}

double Panel::dim(double k, bool hw) {
  int curve = k < 1 ? night_curve_ : day_curve_;
  if (curve != pipe_.curve()) pipe_.set_curve(curve);
  // In hardware down to the window's floor, the renderer below it
  // (color::hw_dim). 40% is about 13% of full light, so night stays as dark
  // as it was, and entirely in hardware.
  int oe = 255;
  double share = k;
  if (hw) {
    color::HwDim d = color::hw_dim(k);
    oe = d.oe;
    share = d.share;
  }
  if (oe != oe_ && dma_) {
    dma_->setBrightness8((uint8_t)oe);
    oe_ = oe;
  }
  return share;
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
  const bool flip = rotation_ == 180;
  for (int y = 0; y < 32; y++) {
    int dy = flip ? 31 - y : y;
    for (int x = 0; x < 64; x++, px += 3) {
      uint8_t r = px[0], g = px[1], b = px[2];
      // The chosen curve, compensated for the driver's own (color.h). The
      // skyline (floor = false) always takes the night curve: the day one's
      // 565 / 6-bit truncation flattens its dark gradients into a few colors.
      (frame_.floor ? pipe_ : scene_pipe_).map(r, g, b, frame_.floor);
      dma_->drawPixelRGB888(flip ? 63 - x : x, dy, r, g, b);
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
  // with a captive portal, or nowifi. A kept connection from before is
  // closed: after a failure or on a new network it can't be trusted.
  drop();
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

struct WifiNet::Conn {
  WiFiClientSecure client;
  HTTPClient http;
};

WifiNet::Conn &WifiNet::conn() {
  if (!conn_) {
    conn_ = new Conn();
    if (s_.tls_verify) conn_->client.setCACert(ROOT_CAS);
    else conn_->client.setInsecure();
    conn_->http.setReuse(true);
    conn_->http.setConnectTimeout(HTTP_CONNECT_MS);
    conn_->http.setTimeout(HTTP_TIMEOUT_MS);
  }
  return *conn_;
}

void WifiNet::drop() {
  if (!conn_) return;
  conn_->http.end();
  conn_->client.stop();
}

// One request on the kept connection. Fills doc (JSON, parsed straight
// from the response) or bytes (binary, exactly `size` of them). A kept
// connection that has gone stale (closed by the server, Fly's proxy, or a
// router) fails while sending; that is retried once on a new connection.
// A read timeout isn't: the server may already have the request.
bool WifiNet::request(const std::string &path, bool auth, bool post, json::Value *doc, size_t size,
                      std::vector<uint8_t> *bytes, std::string &err) {
  for (int attempt = 0;; attempt++) {
    if (feed) feed();
    Conn &c = conn();
    bool reused = c.client.connected();
    if (!reused) connects++;
    if (!c.http.begin(c.client, (s_.url + path).c_str())) {
      err = "Begin";
      drop();
      return false;
    }
    if (auth && !s_.token.empty()) c.http.addHeader("X-Board-Token", s_.token.c_str());
    int code = post ? c.http.POST("") : c.http.GET();
    if (feed) feed();  // the body read gets its own watchdog period
    bool unsent = code == HTTPC_ERROR_SEND_HEADER_FAILED || code == HTTPC_ERROR_SEND_PAYLOAD_FAILED ||
                  code == HTTPC_ERROR_NOT_CONNECTED || code == HTTPC_ERROR_CONNECTION_LOST;
    if (unsent && reused && attempt == 0) {
      drop();
      continue;
    }
    if (code != 200) {
      err = code < 0 ? "Conn" + std::to_string(-code) : "HTTP" + std::to_string(code);
      drop();
      return false;
    }
    bool ok = true;
    if (doc) {
      String s = c.http.getString();
      if (!json::parse(s.c_str(), s.length(), *doc)) {
        err = "JSON";
        ok = false;
      }
    } else {
      int len = c.http.getSize();
      if (len != (int)size) {
        err = "Size" + std::to_string(len < 0 ? 0 : len);
        ok = false;
      } else {
        bytes->assign(size, 0);
        auto *stream = c.http.getStreamPtr();
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
    // A clean answer leaves the connection open for the next request; after
    // anything else its state is unknown, so it's closed.
    if (ok) c.http.end();
    else drop();
    return ok;
  }
}

bool WifiNet::firmware(const std::string &v, long long size, const app::ChunkFn &chunk, std::string &err) {
  // GET /board/firmware (contract): the build, streamed to chunk in 4 KB
  // pieces. A stall longer than HTTP_TIMEOUT_MS fails it; the watchdog is
  // fed after every piece, so the whole download may take longer. It gets
  // its own connection; the kept one is closed first to free its memory.
  if (feed) feed();
  drop();
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
  return request(path, auth, post, &out, 0, nullptr, err);
}

bool WifiNet::get_bytes(const std::string &path, size_t size, std::vector<uint8_t> &out, std::string &err) {
  return request(path, true, false, nullptr, size, &out, err);
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
  // hk on every update: the server decides the clock screen per request (contract).
  return get_json("/board/update?b=" + s_.board_id + (boot ? "&boot=1" : "") + (screen.empty() ? "" : "&s=" + screen) +
                      "&hk=" + app::CAPS,
                  true, out, err);
}

bool WifiNet::radar(const std::string &id, std::vector<uint8_t> &out, std::string &err) {
  // Packed 4 bits a pixel (pk=4): 1024 bytes.
  return get_bytes("/board/radar/" + id + "?b=" + s_.board_id + "&pk=4", 1024, out, err);
}

bool WifiNet::sky(const std::string &id, std::vector<uint8_t> &out, std::string &err) {
  // The skyline's cloud strip: 128 x 26, 4 bits a pixel, 1664 bytes.
  return get_bytes("/board/sky/" + id + "?b=" + s_.board_id, 1664, out, err);
}

bool WifiNet::logo(const std::string &id, std::vector<uint8_t> &out, std::string &err) {
  return get_bytes("/board/logo/" + id + "?b=" + s_.board_id, 24 * 12 * 3, out, err);
}

bool WifiNet::select(const std::string &category, const std::string &variant, json::Value &out, std::string &err) {
  // Category and variant ids are plain lowercase words (contract: knob.ring, knob.vars).
  std::string v = variant.empty() ? "" : "&v=" + variant;
  return get_json("/board/select?b=" + s_.board_id + "&s=" + category + v + "&hk=" + app::CAPS, true, out, err, true);
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
  // Signed by the key CI holds (scripts/firmware-key.js)? Checked before the
  // new slot can become the boot slot.
  if (FIRMWARE_SIGNING_KEY[0] == '\0') {
    err = "NoKey";  // a build from before the signing key existed: OTA stays off
    return false;
  }
  std::vector<uint8_t> sig;
  if (!ota::from_hex(offer.sig, sig) || sig.empty()) {
    err = "Signature";
    return false;
  }
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  bool good = mbedtls_pk_parse_public_key(&pk, (const unsigned char *)FIRMWARE_SIGNING_KEY,
                                          sizeof FIRMWARE_SIGNING_KEY) == 0 &&
              mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, digest, sizeof digest, sig.data(), sig.size()) == 0;
  mbedtls_pk_free(&pk);
  if (!good) {
    err = "Signature";
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

bool Ota::can_verify() { return FIRMWARE_SIGNING_KEY[0] != '\0'; }

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

// ---- WiFi setup ----

static const uint32_t SETUP_IDLE_MS = 15 * 60 * 1000;  // no phone joined this long: retry the saved networks

SetupPortal::SetupPortal(config::Config *cfg, Panel *panel, std::function<void()> feed)
    : cfg_(cfg), panel_(panel), feed_(std::move(feed)) {}

std::string SetupPortal::ssid() const {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[5];
  snprintf(suffix, sizeof suffix, "%02x%02x", mac[4], mac[5]);
  return config::setup_ssid(*cfg_, suffix);
}

void SetupPortal::joined() { nvs_put("fresh", ""); }

// Networks nearby, strongest first, each once, hidden ones left out.
static std::vector<std::string> scan_names() {
  std::vector<std::pair<int, std::string>> found;
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    std::string name = WiFi.SSID(i).c_str();
    if (name.empty()) continue;
    bool dup = false;
    for (auto &f : found)
      if (f.second == name) dup = true;
    if (!dup) found.push_back({WiFi.RSSI(i), name});
  }
  WiFi.scanDelete();
  std::sort(found.begin(), found.end(), [](const auto &a, const auto &b) { return a.first > b.first; });
  std::vector<std::string> out;
  for (auto &f : found) out.push_back(f.second);
  return out;
}

void SetupPortal::run(const std::string &why) {
  std::string name = ssid();
  bool locked = config::setup_pass_ok(cfg_->setup_pass);
  Serial.printf("[setup] opening setup network %s (%s, %s)\n", name.c_str(), locked ? "WPA2" : "open", why.c_str());
  panel_->show([&](draw::Frame &f) { draw::render_status(f, "setup", name); });

  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);  // the station side scans while the network is up
  delay(100);
  std::vector<std::string> seen = scan_names();
  WiFi.softAP(name.c_str(), locked ? cfg_->setup_pass.c_str() : nullptr);
  delay(100);
  IPAddress ip = WiFi.softAPIP();
  DNSServer dns;
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", ip);  // every name points here, so phones show the page
  WebServer web(80);
  std::string note = why == "badwifi" ? "Couldn't join " + (cfg_->networks.empty() ? std::string("that network") : cfg_->networks[0].first) +
                                            ". Check the password and try again."
                     : why == "nowifi" && !cfg_->networks.empty() ? "The board couldn't join any saved network. Choose one."
                                                                   : "";
  bool bad = why == "badwifi" || (why == "nowifi" && !cfg_->networks.empty());
  auto page = [&]() {
    web.sendHeader("Cache-Control", "no-store");
    web.send(200, "text/html; charset=utf-8", config::setup_page(*cfg_, name, seen, note, bad).c_str());
  };
  bool done = false;
  std::string chosen;
  web.on("/", HTTP_GET, page);
  web.on("/scan", HTTP_GET, [&]() {
    seen = scan_names();
    web.sendHeader("Location", "/");
    web.send(302, "text/plain", "");
  });
  web.on("/save", HTTP_POST, [&]() {
    std::string other = web.arg("o").c_str(), pick = web.arg("s").c_str(), pass = web.arg("p").c_str();
    std::string ssid = other.empty() ? pick : other;
    std::string err;
    if (!config::check_network(ssid, pass, &err)) {
      note = err;
      bad = true;
      page();
      return;
    }
    config::Config next = *cfg_;
    config::add_network(next, ssid, pass);
    if (!nvs_put("cfg", config::to_json(next)) || !nvs_put("fresh", "1")) {
      note = "Couldn't save on the board. Try again.";
      bad = true;
      page();
      return;
    }
    *cfg_ = next;
    chosen = ssid;
    web.sendHeader("Cache-Control", "no-store");
    web.send(200, "text/html; charset=utf-8", config::saved_page(ssid).c_str());
    done = true;
  });
  // Phones probe a known address on joining (Apple's hotspot-detect,
  // Android's generate_204); anything but the expected answer opens the page.
  web.onNotFound([&]() {
    web.sendHeader("Location", String("http://") + ip.toString() + "/");
    web.send(302, "text/plain", "");
  });
  web.begin();

  uint32_t idle_since = millis();
  uint32_t finished = 0;
  while (true) {
    if (feed_) feed_();
    dns.processNextRequest();
    web.handleClient();
    if (WiFi.softAPgetStationNum() > 0) idle_since = millis();
    if (done && !finished) finished = millis();
    if (finished && millis() - finished > 1500) {  // let the saved page reach the phone
      Serial.printf("[setup] saved %s; restarting to join it\n", chosen.c_str());
      break;
    }
    if (!cfg_->networks.empty() && millis() - idle_since > SETUP_IDLE_MS) {
      Serial.println("[setup] nobody joined; restarting to try the saved networks");
      break;
    }
    delay(5);
  }
  web.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
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

// The push button: seesaw GPIO 24, an input with its pull-up (low when pressed).
static const uint8_t SEESAW_GPIO = 0x01, SEESAW_GPIO_DIRCLR = 0x03, SEESAW_GPIO_BULK = 0x04, SEESAW_GPIO_SET = 0x05,
                     SEESAW_GPIO_PULLEN = 0x0B;
static const uint32_t KNOB_BUTTON = 1UL << 24;

static bool seesaw_write32(uint8_t base, uint8_t reg, uint32_t v) {
  Wire.beginTransmission(SEESAW_ADDR);
  Wire.write(base);
  Wire.write(reg);
  Wire.write((uint8_t)(v >> 24));
  Wire.write((uint8_t)(v >> 16));
  Wire.write((uint8_t)(v >> 8));
  Wire.write((uint8_t)v);
  return Wire.endTransmission() == 0;
}

bool Knob::pressed() {
  if (!on_) return false;
  // Every loop pass asks; the I2C bus is read at most every KNOB_POLL_MS.
  uint32_t now = millis();
  if (press_polled_ && now - press_polled_ < KNOB_POLL_MS) return press_;
  press_polled_ = now ? now : 1;
  if (!button_) {
    button_ = seesaw_write32(SEESAW_GPIO, SEESAW_GPIO_DIRCLR, KNOB_BUTTON) &&
              seesaw_write32(SEESAW_GPIO, SEESAW_GPIO_PULLEN, KNOB_BUTTON) &&
              seesaw_write32(SEESAW_GPIO, SEESAW_GPIO_SET, KNOB_BUTTON);
    delay(5);
    if (!button_) return false;
  }
  uint8_t d[4];
  if (!read(SEESAW_GPIO, SEESAW_GPIO_BULK, d, 4)) return false;
  uint32_t bits = ((uint32_t)d[0] << 24) | ((uint32_t)d[1] << 16) | ((uint32_t)d[2] << 8) | d[3];
  press_ = !(bits & KNOB_BUTTON);
  return press_;
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

// ---- light sensor ----
// VEML7700 at its fixed address, on the same I2C bus as the knob. Gain x2
// and 800 ms integration: the most sensitive setting (0.0036 lx a count, up
// to ~236 lx), since the case's 2 mm hole passes only a few percent of the
// room's light. It integrates continuously; a read returns the last result.
// Each read checks the setting first: a sensor unplugged and plugged back in
// powers up at its defaults (x1, 100 ms: readings ~16x low), so it's set
// again and the next integration awaited.

static const uint8_t VEML_ADDR = 0x10;
static const uint8_t VEML_CONF = 0x00, VEML_ALS = 0x04, VEML_ID = 0x07;
static const uint16_t VEML_GAIN2_IT800 = (0b01 << 11) | (0b0011 << 6);  // power on (ALS_SD 0)
static const double VEML_LUX_PER_COUNT = 0.0036;
static const uint32_t VEML_FIRST_MS = 900;  // one integration, plus a margin

static bool veml_read16(uint8_t reg, uint16_t &out) {
  Wire.beginTransmission(VEML_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;  // repeated start
  if (Wire.requestFrom((int)VEML_ADDR, 2) != 2) return false;
  uint8_t lo = (uint8_t)Wire.read(), hi = (uint8_t)Wire.read();
  out = (uint16_t)(lo | (hi << 8));
  return true;
}

static bool veml_configure() {
  Wire.beginTransmission(VEML_ADDR);
  Wire.write(VEML_CONF);
  Wire.write((uint8_t)(VEML_GAIN2_IT800 & 0xff));
  Wire.write((uint8_t)(VEML_GAIN2_IT800 >> 8));
  return Wire.endTransmission() == 0;
}

bool LightSensor::begin() {
  Wire.begin();  // already started by the knob; harmless again
  uint16_t id = 0;
  on_ = veml_read16(VEML_ID, id) && (id & 0xff) == 0x81 && veml_configure();
  ready_at_ = millis() + VEML_FIRST_MS;
  Serial.println(on_ ? "[light] VEML7700 found; auto brightness follows it" : "[light] no light sensor");
  return on_;
}

bool LightSensor::read(double &lux) {
  if (!on_ || (int32_t)(millis() - ready_at_) < 0) return false;
  uint16_t conf, counts;
  if (!veml_read16(VEML_CONF, conf)) return false;
  if (conf != VEML_GAIN2_IT800) {
    Serial.printf("[light] sensor setting was 0x%04x (replugged?); setting it again\n", conf);
    veml_configure();
    ready_at_ = millis() + VEML_FIRST_MS;
    return false;
  }
  if (!veml_read16(VEML_ALS, counts)) return false;
  lux = counts * VEML_LUX_PER_COUNT;
  return true;
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
// Resets the board if the loop stops feeding it: a hung loop, or (with the
// network worker) a request out longer than app::WORK_STUCK_MS. Without the
// worker the loop feeds it every pass and the network before each request,
// so one request gets the whole timeout.

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
  owner_ = xTaskGetCurrentTaskHandle();
  if (!on_) Serial.println("[board] no watchdog");
}

void Watchdog::feed() {
  if (on_ && xTaskGetCurrentTaskHandle() == (TaskHandle_t)owner_) esp_task_wdt_reset();
}

// ---- network worker ----

static const uint32_t NET_STACK = 16 * 1024;  // TLS (mbedtls) needs about as much as the loop task's 16 KB

bool NetWorker::begin() {
  go_ = xSemaphoreCreateBinary();
  if (!go_) return false;
  return xTaskCreatePinnedToCore(task, "net", NET_STACK, this, 1, nullptr, 0) == pdPASS;
}

void NetWorker::start(std::function<void()> work) {
  work_ = std::move(work);
  done_.store(false, std::memory_order_release);
  xSemaphoreGive((SemaphoreHandle_t)go_);
}

void NetWorker::task(void *arg) {
  NetWorker *w = (NetWorker *)arg;
  for (;;) {
    if (xSemaphoreTake((SemaphoreHandle_t)w->go_, portMAX_DELAY) != pdTRUE) continue;
    if (w->work_) w->work_();
    w->done_.store(true, std::memory_order_release);
  }
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
long psram_size() { return (long)ESP.getPsramSize(); }

float chip_temp_c() {
  // temperatureRead() (Arduino-ESP32) reads the S3's built-in sensor; single reads jitter by about 1 C.
  float sum = 0;
  for (int i = 0; i < 8; i++) sum += temperatureRead();
  return sum / 8;
}

}  // namespace device

#endif  // ARDUINO
