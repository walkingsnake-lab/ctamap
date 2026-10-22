// Renders the scenarios from firmware/tests/scenarios.js with the S3
// firmware's renderer (firmware-s3/ctaboard/src/draw.cpp) and compares every
// pixel with draw.js. The C++ twin of firmware/tests/parity.py.
//   parity scenarios.json
// Exit status 0 when everything matches; otherwise prints the first mismatches.

#include <stdio.h>

#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "../ctaboard/src/draw.h"
#include "../ctaboard/src/json.h"

using draw::Frame;
using json::Value;

static std::vector<uint8_t> b64(const std::string &s) {
  static const std::string A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::vector<uint8_t> out;
  int val = 0, bits = -8;
  for (char c : s) {
    size_t i = A.find(c);
    if (i == std::string::npos) continue;
    val = (val << 6) + (int)i;
    bits += 6;
    if (bits >= 0) {
      out.push_back((uint8_t)((val >> bits) & 0xFF));
      bits -= 8;
    }
  }
  return out;
}

static std::map<std::string, std::vector<uint8_t>> byte_map(const Value &v) {
  std::map<std::string, std::vector<uint8_t>> out;
  for (const auto &kv : v.o) {
    std::vector<uint8_t> b;
    for (const Value &x : kv.second.a) b.push_back((uint8_t)x.num());
    out[kv.first] = b;
  }
  return out;
}

static draw::Rolls rolls_of(const Value &v) {
  draw::Rolls out;
  for (const auto &kv : v.o) out[kv.first] = draw::Roll{draw::U(json::str(kv.second["from"])), kv.second["p"].num()};
  return out;
}

static std::string diff(const std::string &name, const std::string &want_b64, const Frame &f, size_t limit = 6) {
  std::vector<uint8_t> want = b64(want_b64);
  std::vector<std::string> bad;
  for (size_t i = 0; i + 2 < want.size() && i + 2 < sizeof f.px; i += 3) {
    if (want[i] != f.px[i] || want[i + 1] != f.px[i + 1] || want[i + 2] != f.px[i + 2]) {
      size_t p = i / 3;
      char buf[120];
      snprintf(buf, sizeof buf, "(%zu,%zu) want (%d, %d, %d) got (%d, %d, %d)", p % 64, p / 64, want[i], want[i + 1],
               want[i + 2], f.px[i], f.px[i + 1], f.px[i + 2]);
      bad.push_back(buf);
    }
  }
  if (bad.empty() && want.size() == sizeof f.px) return "";
  std::string out = name + ": " + std::to_string(bad.size()) + " px differ: ";
  for (size_t i = 0; i < bad.size() && i < limit; i++) out += (i ? "; " : "") + bad[i];
  return out;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: parity scenarios.json\n");
    return 2;
  }
  std::ifstream in(argv[1]);
  std::stringstream ss;
  ss << in.rdbuf();
  Value scenarios;
  std::string err;
  if (!json::parse(ss.str(), scenarios, &err)) {
    fprintf(stderr, "bad scenarios json: %s\n", err.c_str());
    return 2;
  }
  std::vector<std::string> fails;
  int count = 0;
  for (const Value &s : scenarios.a) {
    std::string name = json::str(s["name"]);
    if (s.has("renders")) {
      draw::Frames frames = byte_map(s["frames"]);
      draw::Logos logos = byte_map(s["logos"]);
      bool has_frames = s["frames"].truthy();
      bool has_logos = s["logos"].truthy();
      for (const Value &r : s["renders"].a) {
        const Value &o = r["opts"];
        draw::RenderOpts ro;
        std::string screen = json::str(o["screen"]);
        if (!o["screen"].is_null()) ro.screen = screen.c_str();
        if (!o["now"].is_null()) ro.now = o["now"].num();
        ro.blink = o["blink"].truthy();
        ro.page = (int)o["page"].num(0);
        ro.slide = o["slide"].num(0);
        if (!o["idx"].is_null()) ro.idx = (int)o["idx"].num();
        ro.frames = has_frames ? &frames : nullptr;
        if (!o["game"].is_null()) ro.game = (int)o["game"].num();
        draw::Rolls rolls = rolls_of(o["rolls"]);
        draw::Rolls nums = rolls_of(o["nums"]);
        ro.rolls = o["rolls"].is_null() ? nullptr : &rolls;
        ro.logos = has_logos ? &logos : nullptr;
        if (!o["t"].is_null()) ro.t = o["t"].num();
        ro.nums = o["nums"].is_null() ? nullptr : &nums;
        Frame f;
        draw::render(s["payload"], f, ro);
        count++;
        std::string d = diff(name + " " + json::str(o["screen"]) + (o.size() > 1 ? " +opts" : ""), json::str(r["px"]), f);
        if (!d.empty()) fails.push_back(d);
      }
    } else {
      draw::TransitAnimator anim;
      int i = 0;
      for (const Value &st : s["steps"].a) {
        draw::View view = anim.step(st["payload"], st["now"].num(), st["t"].num());
        draw::RenderOpts ro;
        ro.screen = "transit";
        ro.now = st["now"].num();
        ro.view = &view;
        ro.blink = st["blink"].truthy();
        Frame f;
        draw::render(st["payload"], f, ro);
        count++;
        std::string d = diff(name + " step " + std::to_string(i) + " (t=" + json::str(st["t"]) + ")", json::str(st["px"]), f);
        if (!d.empty()) fails.push_back(d);
        i++;
      }
    }
  }
  for (size_t i = 0; i < fails.size() && i < 20; i++) printf("%s\n", fails[i].c_str());
  printf("%d frames compared, %zu differ\n", count, fails.size());
  return fails.empty() ? 0 : 1;
}
