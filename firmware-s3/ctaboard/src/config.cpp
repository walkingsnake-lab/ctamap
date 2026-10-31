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
  key(o, "setup_name");
  put_str(o, c.setup_name);
  key(o, "setup_pass");
  put_str(o, c.setup_pass);
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
  str("setup_name", c.setup_name);
  str("setup_pass", c.setup_pass);
  out = c;
  return true;
}

bool usable(const Config &c, std::string *why) {
  auto no = [&](const char *w) {
    if (why) *why = w;
    return false;
  };
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
      // Already saved from this secrets.h: flash wins (the setup page may
      // have added networks since).
      ch.source = FROM_FLASH;
      ch.cfg = flash;
    } else {
      ch.source = FROM_BUILD;
      ch.cfg = *built;
      // A secrets.h without networks (a board for someone else) keeps the
      // networks entered on its setup page.
      if (built->networks.empty() && have_flash) ch.cfg.networks = flash.networks;
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

// ---- WiFi setup ----

std::string setup_ssid(const Config &c, const std::string &mac_suffix) {
  if (!c.setup_name.empty()) return c.setup_name.substr(0, 32);
  std::string s = "Board-";
  for (char ch : mac_suffix) s += (char)(ch >= 'a' && ch <= 'z' ? ch - 'a' + 'A' : ch);
  return s;
}

bool setup_pass_ok(const std::string &p) { return p.size() >= 8 && p.size() <= 63; }

bool check_network(const std::string &ssid, const std::string &pass, std::string *why) {
  auto no = [&](const char *w) {
    if (why) *why = w;
    return false;
  };
  if (ssid.empty()) return no("Pick a network or type its name.");
  if (ssid.size() > 32) return no("That network name is too long (32 characters at most).");
  if (!pass.empty() && pass.size() < 8) return no("WiFi passwords are at least 8 characters. Leave it empty for an open network.");
  if (pass.size() > 63) return no("That password is too long (63 characters at most).");
  return true;
}

void add_network(Config &c, const std::string &ssid, const std::string &pass) {
  std::vector<std::pair<std::string, std::string>> out = {{ssid, pass}};
  for (const auto &n : c.networks)
    if (n.first != ssid && out.size() < MAX_NETWORKS) out.push_back(n);
  c.networks = out;
}

std::string html_escape(const std::string &s) {
  std::string o;
  for (char ch : s) {
    switch (ch) {
      case '&': o += "&amp;"; break;
      case '<': o += "&lt;"; break;
      case '>': o += "&gt;"; break;
      case '"': o += "&quot;"; break;
      case '\'': o += "&#39;"; break;
      default: o += ch;
    }
  }
  return o;
}

static const char *PAGE_HEAD =
    "<!doctype html><html><head><meta charset=utf-8>"
    "<meta name=viewport content='width=device-width,initial-scale=1'><title>Board setup</title><style>"
    "body{margin:0;background:#0b0b0b;color:#e4e4e4;font:16px/1.4 -apple-system,system-ui,sans-serif}"
    "main{max-width:420px;margin:0 auto;padding:20px 16px}h1{font-size:20px;margin:0 0 4px}"
    "p{color:#8f8f8f;font-size:14px;margin:6px 0 14px}label{display:block;font-size:13px;color:#8f8f8f;margin:14px 0 4px}"
    "select,input{width:100%;box-sizing:border-box;font:inherit;color:#e4e4e4;background:#141414;border:1px solid #333;border-radius:9px;padding:11px}"
    "button{width:100%;margin-top:18px;font:inherit;font-weight:600;padding:12px;border:0;border-radius:9px;background:#ffb000;color:#111}"
    ".note{color:#e4e4e4;background:#1c1c1c;border:1px solid #333;border-radius:9px;padding:10px}.bad{border-color:#5a2a2a;color:#ff6b6b}"
    "a{color:#8f8f8f}</style></head><body><main>";

std::string setup_page(const Config &c, const std::string &ssid, const std::vector<std::string> &seen,
                       const std::string &note, bool bad) {
  std::string o = PAGE_HEAD;
  o += "<h1>Connect " + html_escape(ssid) + " to WiFi</h1>";
  o += "<p>Choose your home network. The board joins it and starts showing arrivals.</p>";
  if (!note.empty()) o += std::string("<p class='note") + (bad ? " bad" : "") + "'>" + html_escape(note) + "</p>";
  o += "<form method=post action=/save><label for=s>Network</label><select id=s name=s>";
  for (const std::string &n : seen) o += "<option value=\"" + html_escape(n) + "\">" + html_escape(n) + "</option>";
  if (seen.empty()) o += "<option value=''>No networks found</option>";
  o += "</select><label for=o>Or type its name (hidden networks)</label>"
       "<input id=o name=o maxlength=32 autocapitalize=off autocorrect=off spellcheck=false>"
       "<label for=p>Password</label><input id=p name=p type=password maxlength=63 autocomplete=off>"
       "<button>Connect</button></form><p><a href=/scan>Look for networks again</a></p>";
  if (!c.networks.empty()) {
    o += "<p>Already saved: ";
    for (size_t i = 0; i < c.networks.size(); i++) o += (i ? ", " : "") + html_escape(c.networks[i].first);
    o += ". A new network is tried first.</p>";
  }
  return o + "</main></body></html>";
}

std::string saved_page(const std::string &ssid) {
  return std::string(PAGE_HEAD) + "<h1>Saved</h1><p class=note>The board is joining " + html_escape(ssid) +
         ". This setup network closes now; reconnect your phone to your usual WiFi.</p>"
         "<p>If the password was wrong, the setup network comes back in about a minute.</p></main></body></html>";
}

}  // namespace config
