// The board's settings (WiFi networks, server, board ID, token, panel
// tuning), kept in the board's flash (NVS) rather than compiled in, so one
// build runs on every board and can be installed over the air.
//
// A build compiled with secrets.h (a "setup build", flashed over USB) writes
// its values to flash on startup whenever they differ from what it wrote
// last time; a build without secrets.h (the generic build that OTA updates
// install) uses what's in flash. Plain C++: device.cpp does the NVS reads
// and writes, and firmware-s3/tests/config_test.cpp checks the rest.
#pragma once

#include <stdint.h>

#include <string>
#include <utility>
#include <vector>

namespace config {

struct Config {
  std::vector<std::pair<std::string, std::string>> networks;  // (ssid, password), tried in order
  std::string url = "https://ctamap.fly.dev";
  std::string board_id = "home";
  std::string token;
  int rotation = 0;     // 0 or 180
  int curve = 2;        // color::CIRCUITPY
  int night_curve = 3;  // color::GAMMA26
  bool hw_dim = true;
  int status_led = 2;
  bool tls_verify = true;
  bool clk_phase = false;
  bool double_buffer = true;
  std::string color_order = "RGB";
  bool knob_reverse = false;
  // The board's own setup network (WiFi setup without USB): its name ("":
  // Board-<last 4 hex of the MAC>) and WPA2 password ("": open). Both go on
  // the label, as a WiFi QR code that joins it.
  std::string setup_name;
  std::string setup_pass;
};

const size_t MAX_NETWORKS = 8;

// Settings as one JSON object (how they're kept in flash), and back. Fields
// missing from the JSON keep their defaults, so settings added later read
// from an older flash copy.
std::string to_json(const Config &c);
bool from_json(const std::string &text, Config &out, std::string *err = nullptr);

// Enough to run: a server and a valid board ID. No WiFi networks is fine:
// the board opens its setup network.
bool usable(const Config &c, std::string *why = nullptr);

// ---- WiFi setup (the board's own network and setup page; device.cpp
// serves it, these build and check what it serves) ----

// The setup network's name: setup_name, else Board-<mac_suffix>.
std::string setup_ssid(const Config &c, const std::string &mac_suffix);
// A WPA2 password needs 8-63 characters; anything else makes it open.
bool setup_pass_ok(const std::string &p);
// Checks a network typed on the setup page (WiFi limits: name 1-32 bytes,
// password empty or 8-63 characters).
bool check_network(const std::string &ssid, const std::string &pass, std::string *why = nullptr);
// Puts the network first (replacing one with the same name), keeping at
// most MAX_NETWORKS.
void add_network(Config &c, const std::string &ssid, const std::string &pass);
std::string html_escape(const std::string &s);
// The setup page: a form posting s (a seen network), o (a typed name, which
// wins) and p (password) to /save. `seen`: networks found nearby, strongest
// first; `note`: a message at the top ("" for none), `bad`: show it as an error.
std::string setup_page(const Config &c, const std::string &ssid, const std::vector<std::string> &seen,
                       const std::string &note, bool bad);
// The page after saving.
std::string saved_page(const std::string &ssid);

// FNV-1a of the text as 8 hex digits: the fingerprint of the setup build's
// settings, so a USB flash with an edited secrets.h rewrites them.
std::string fingerprint(const std::string &text);

enum Source { FROM_BUILD, FROM_FLASH, NONE };

struct Choice {
  Source source = NONE;
  bool write = false;  // save `cfg` and `seed` to flash
  Config cfg;
  std::string seed;    // fingerprint of the setup build's settings (FROM_BUILD)
  std::string why;     // NONE: what's missing
};

// built: the setup build's compiled settings, or null for a generic build.
// stored / stored_seed: what flash holds ("" when empty).
Choice choose(const Config *built, const std::string &stored, const std::string &stored_seed);

}  // namespace config
