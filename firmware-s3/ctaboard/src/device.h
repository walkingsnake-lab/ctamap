// Matrix Portal S3 hardware: the HUB75 panel (through the
// ESP32-HUB75-MatrixPanel-DMA library), WiFi + HTTPS, the UP/DOWN buttons,
// the knob (Adafruit 5880 rotary encoder on the STEMMA QT port), the status
// NeoPixel, and the watchdog. The C++ counterpart of
// firmware/boardlib/device.py. Board-only: everything else builds natively
// for tests, and the rest of the firmware takes this hardware through the
// interfaces in app.h.
#pragma once

#ifdef ARDUINO

#include <functional>
#include <string>

#include "app.h"
#include "color.h"
#include "draw.h"

class MatrixPanel_I2S_DMA;

namespace device {

struct Settings {
  app::Networks networks;
  std::string url = "https://ctamap.fly.dev";
  std::string board_id = "home";
  std::string token;
  int rotation = 0;     // 0, or 180 when the panel is mounted upside down
  int curve = color::CIRCUITPY;        // color curve at full brightness (color.h)
  int night_curve = color::GAMMA26;    // color curve while dimmed (night)
  bool hw_dim = true;                  // dim in hardware (full color steps) or scale colors
  int status_led = 2;   // 2: every state; 1: no fetch light; 0: off
  bool tls_verify = true;
  // Panel driver. clk_phase: false = data latched on the falling clock edge
  // (the driver's default, true, showed this P3 panel 1 px left with stray
  // pixels). double_buffer: draw into a back buffer and flip it in.
  bool clk_phase = false;
  bool double_buffer = true;
  // Which color each HUB75 data line (R, G, B, in that order) lights on this panel: "RGB" normally; some panels
  // are wired "RBG" (green and blue swapped) or another order. Applied by reassigning the data pins, so it costs nothing.
  const char *color_order = "RGB";
};

// The panel: frames are drawn into a draw::Frame, then copied to the DMA
// back buffer and flipped in, so a frame never shows half drawn.
class Panel : public app::Display {
 public:
  explicit Panel(const Settings &s);
  bool begin();
  void show(const std::function<void(draw::Frame &)> &fn) override;
  long last_ms = 0, max_ms = 0;  // draw time, for the serial report
  int refresh_rate() const;
  bool set_brightness(double k) override;
  // Brightness k (0-1) with the day curve at full brightness and the night
  // curve below it; hw: dim in hardware (else the renderer scales colors).
  void dim(double k, bool hw);
  void set_curves(int day, int night);
  int day_curve() const { return day_curve_; }
  int night_curve() const { return night_curve_; }

 private:
  MatrixPanel_I2S_DMA *dma_ = nullptr;
  draw::Frame frame_;
  int rotation_;
  color::Pipeline pipe_;
  int day_curve_, night_curve_;
  bool hw_dim_;
  int oe_ = 255;  // the driver's brightness (output-enable window), 0-255
  bool clk_phase_, double_buffer_;
  std::string color_order_;
  int64_t flipped_at_ = 0;  // us; when the last back buffer was flipped in
};

class WifiNet : public app::Net {
 public:
  explicit WifiNet(const Settings &s);
  app::ConnectResult connect(const app::Networks &networks, const app::StatusFn &status) override;
  bool version(const std::string &health, json::Value &out, std::string &err) override;
  bool update(bool boot, const std::string &screen, json::Value &out, std::string &err) override;
  bool radar(const std::string &id, std::vector<uint8_t> &out, std::string &err) override;
  bool logo(const std::string &id, std::vector<uint8_t> &out, std::string &err) override;
  bool select(const std::string &category, json::Value &out, std::string &err) override;
  bool rssi(int &out) override;
  std::string mac() const;
  std::function<void()> feed;  // watchdog feed, before each request and while joining

 private:
  Settings s_;
  bool ping();
  bool join(const std::string &ssid, const std::string &password, const app::StatusFn &status);
  void reset_radio(const char *why);
  bool get_json(const std::string &path, bool auth, json::Value &out, std::string &err, bool post = false);
  bool get_bytes(const std::string &path, size_t size, std::vector<uint8_t> &out, std::string &err);
};

class SysClock : public app::Clock {
 public:
  long long ms() override;
  void sleep_ms(long long ms) override;
};

class Buttons : public app::Buttons {
 public:
  Buttons();
  bool up() override;
  bool down() override;
};

// Adafruit 5880 (seesaw I2C rotary encoder) on the STEMMA QT port. begin()
// finds it; without one, clicks() is always 0 and the board runs as before.
class Knob : public app::Knob {
 public:
  explicit Knob(bool reverse = false) : reverse_(reverse) {}
  bool begin();
  int clicks() override;

 private:
  bool reverse_;
  bool on_ = false;
  uint32_t polled_ = 0;
  bool read(uint8_t base, uint8_t reg, uint8_t *buf, size_t n);
};

class StatusLed : public app::Led {
 public:
  explicit StatusLed(int mode);
  void set(const std::string &name) override;

 private:
  int mode_;
  std::string state_;
};

class Watchdog : public app::Watchdog {
 public:
  explicit Watchdog(int seconds = 16);
  void feed() override;

 private:
  bool on_ = false;
};

std::string start_reason();  // POWER_ON, RESET_PIN, SOFTWARE, PANIC, WATCHDOG, BROWNOUT, ...
bool cold_boot();            // power-on or the RESET button (not a crash or watchdog restart)
long free_heap();
long largest_block();
float chip_temp_c();  // ESP32-S3 internal sensor: die temperature in C (mean of 8 reads; tracks the air around the board)

}  // namespace device

#endif  // ARDUINO
