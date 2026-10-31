// Board settings in flash; see config.h.

#include "config.h"

#include <stdio.h>

#include "json.h"

namespace config {

static void put_str(std::string &out, const std::string &s) {
  out += '"';
  for (unsigned char ch : s) {
    if (ch == '"' || ch == '\\') {
      out += '\\';
      out += (char)ch;
    } else if (ch < 0x20) {
      char buf[8];
      snprintf(buf, sizeof buf, "\\u%04x", ch);
      out += buf;
    } else {
      out += (char)ch;  // UTF-8 passes through
    }
  }
  out += '"';
}

static void key(std::string &out, const char *k) {
  if (out.size() > 1) out += ',';
  put_str(out, k);
  out += ':';
}

std::string to_json(const Config &c) {
  std::string o = "{";
  key(o, "networks");
  o += '[';
  for (size_t i = 0; i < c.networks.size(); i++) {
    if (i) o += ',';
    o += '[';
    put_str(o, c.networks[i].first);
    o += ',';
    put_str(o, c.networks[i].second);
    o += ']';
  }
  o += ']';
  key(o, "url");
  put_str(o, c.url);
  key(o, "board_id");
  put_str(o, c.board_id);
  key(o, "token");
  put_str(o, c.token);
  auto num = [&](const char *k, int v) {
    key(o, k);
    o += std::to_string(v);
  };
  auto flag = [&](const char *k, bool v) {
    key(o, k);
    o += v ? "true" : "false";
  };
  num("rotation", c.rotation);
  num("curve", c.curve);
  num("night_curve", c.night_curve);
  flag("hw_dim", c.hw_dim);
  num("status_led", c.status_led);
  flag("tls_verify", c.tls_verify);
  flag("clk_phase", c.clk_phase);
  flag("double_buffer", c.double_buffer);
  key(o, "color_order");
  put_str(o, c.color_order);
  flag("knob_reverse", c.knob_reverse);
  return o + "}";
}

bool from_json(const std::string &text, Config &out, std::string *err) {
  json::Value v;
  if (!json::parse(text, v, err)) return false;
  if (!v.is_obj()) {
    if (err) *err = "not an object";
    return false;
  }
  Config c;
  const json::Value &nets = v["networks"];
  for (size_t i = 0; i < nets.size(); i++) {
    const json::Value &n = nets[i];
    if (n[0].is_str() && n[1].is_str()) c.networks.push_back({n[0].s, n[1].s});
  }
  auto str = [&](const char *k, std::string &dst) {
    if (v[k].is_str()) dst = v[k].s;
  };
  auto num = [&](const char *k, int &dst) {
    if (v[k].is_num()) dst = (int)v[k].n;
  };
  auto flag = [&](const char *k, bool &dst) {
    if (v[k].type == json::BOOL) dst = v[k].b;
  };
  str("url", c.url);
  str("board_id", c.board_id);
  str("token", c.token);
  num("rotation", c.rotation);
  num("curve", c.curve);
  num("night_curve", c.night_curve);
  flag("hw_dim", c.hw_dim);
  num("status_led", c.status_led);
  flag("tls_verify", c.tls_verify);
  flag("clk_phase", c.clk_phase);
  flag("double_buffer", c.double_buffer);
  str("color_order", c.color_order);
  flag("knob_reverse", c.knob_reverse);
  out = c;
  return true;
}

bool usable(const Config &c, std::string *why) {
  auto no = [&](const char *w) {
    if (why) *why = w;
    return false;
  };
  if (c.networks.empty()) return no("no WiFi networks");
  if (c.url.empty()) return no("no server URL");
  if (c.board_id.empty() || c.board_id.size() > 32) return no("no board ID");
  for (char ch : c.board_id)
    if (!((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-')) return no("board ID must be a-z, 0-9, -");
  return true;
}

std::string fingerprint(const std::string &text) {
  uint32_t h = 2166136261u;
  for (unsigned char ch : text) {
    h ^= ch;
    h *= 16777619u;
  }
  char buf[9];
  snprintf(buf, sizeof buf, "%08x", (unsigned)h);
  return buf;
}

Choice choose(const Config *built, const std::string &stored, const std::string &stored_seed) {
  Choice ch;
  Config flash;
  bool have_flash = !stored.empty() && from_json(stored, flash);
  if (built) {
    std::string seed = fingerprint(to_json(*built));
    ch.seed = seed;
    if (have_flash && stored_seed == seed) {
      // Already saved from this secrets.h: flash wins (it may have been
      // changed since, by a later settings path).
      ch.source = FROM_FLASH;
      ch.cfg = flash;
    } else {
      ch.source = FROM_BUILD;
      ch.cfg = *built;
      ch.write = true;
    }
    return ch;
  }
  std::string why;
  if (!have_flash) {
    ch.why = stored.empty() ? "no settings saved" : "saved settings unreadable";
    return ch;
  }
  if (!usable(flash, &why)) {
    ch.why = why;
    return ch;
  }
  ch.source = FROM_FLASH;
  ch.cfg = flash;
  return ch;
}

}  // namespace config
