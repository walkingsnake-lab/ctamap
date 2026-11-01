// Settings in flash (src/config.h): saving and reading them back, and which
// settings a build runs with: a setup build's secrets.h or what flash holds.
// Also the OTA status screens (src/draw.cpp render_status).
//   config_test   (exit status 0 when every check passes)

#include <stdio.h>

#include <string>

#include "../ctaboard/src/config.h"
#include "../ctaboard/src/draw.h"

static int g_failed = 0, g_checks = 0;
#define CHECK(cond, ...)                                            \
  do {                                                              \
    g_checks++;                                                     \
    if (!(cond)) {                                                  \
      g_failed++;                                                   \
      printf("FAIL line %d: %s", __LINE__, #cond);                  \
      printf(" " __VA_ARGS__);                                      \
      printf("\n");                                                 \
    }                                                               \
  } while (0)

static config::Config sample() {
  config::Config c;
  c.networks = {{"home \"net\"", "pa\\ss"}, {"Jake's iPhone", "p\xc3\xa9"}};
  c.board_id = "office";
  c.token = "tok";
  c.rotation = 180;
  c.curve = 1;
  c.night_curve = 2;
  c.hw_dim = false;
  c.status_led = 1;
  c.tls_verify = false;
  c.clk_phase = true;
  c.double_buffer = false;
  c.color_order = "RBG";
  c.knob_reverse = true;
  return c;
}

static void round_trip() {
  config::Config a = sample(), b;
  std::string err;
  CHECK(config::from_json(config::to_json(a), b, &err), "%s", err.c_str());
  CHECK(b.networks == a.networks, "");
  CHECK(b.board_id == "office" && b.token == "tok" && b.url == a.url, "");
  CHECK(b.rotation == 180 && b.curve == 1 && b.night_curve == 2 && !b.hw_dim && b.status_led == 1, "");
  CHECK(!b.tls_verify && b.clk_phase && !b.double_buffer && b.color_order == "RBG" && b.knob_reverse, "");
  CHECK(config::to_json(b) == config::to_json(a), "");
}

static void missing_fields_keep_defaults() {
  // Settings saved by an older build lack fields added since.
  config::Config c;
  CHECK(config::from_json("{\"networks\":[[\"a\",\"b\"]],\"board_id\":\"home\"}", c), "");
  config::Config d;
  CHECK(c.url == d.url && c.curve == d.curve && c.hw_dim == d.hw_dim && c.color_order == "RGB", "");
  CHECK(!config::from_json("not json", c), "");
  CHECK(!config::from_json("[1]", c), "");
}

static void usable() {
  config::Config c = sample();
  CHECK(config::usable(c), "");
  c.board_id = "Office";
  std::string why;
  CHECK(!config::usable(c, &why) && !why.empty(), "");
  c = sample();
  c.networks.clear();
  CHECK(!config::usable(c), "");
}

static void choose() {
  config::Config built = sample();
  std::string j = config::to_json(built), fp = config::fingerprint(j);
  // Setup build, empty flash: save secrets.h.
  config::Choice c = config::choose(&built, "", "");
  CHECK(c.source == config::FROM_BUILD && c.write && c.seed == fp, "");
  // Setup build again, nothing changed: use flash, no write.
  c = config::choose(&built, j, fp);
  CHECK(c.source == config::FROM_FLASH && !c.write && c.cfg.board_id == "office", "");
  // Edited secrets.h: saved again.
  config::Config edited = built;
  edited.networks.push_back({"work", "pw"});
  c = config::choose(&edited, j, fp);
  CHECK(c.source == config::FROM_BUILD && c.write && c.cfg.networks.size() == 3, "");
  // Generic build: flash, never written.
  c = config::choose(nullptr, j, fp);
  CHECK(c.source == config::FROM_FLASH && !c.write && c.cfg.token == "tok", "");
  // Generic build on a board never set up.
  c = config::choose(nullptr, "", "");
  CHECK(c.source == config::NONE && !c.why.empty(), "");
  c = config::choose(nullptr, "garbage", "");
  CHECK(c.source == config::NONE, "");
  CHECK(config::fingerprint("a") != config::fingerprint("b") && config::fingerprint("a").size() == 8, "");
}

static int lit(const draw::Frame &f, int y0, int y1) {
  int n = 0;
  for (int y = y0; y < y1; y++)
    for (int x = 0; x < 64; x++) {
      int i = (y * 64 + x) * 3;
      if (f.px[i] || f.px[i + 1] || f.px[i + 2]) n++;
    }
  return n;
}

static void status_screens() {
  draw::Frame a, b;
  draw::render_status(a, "updating", "45");
  draw::render_status(b, "updating", "4");
  CHECK(lit(a, 0, 15) > 20, "UPDATING");
  CHECK(lit(a, 16, 32) > lit(b, 16, 32), "the percentage is drawn");
  draw::Frame c;
  draw::render_status(c, "nosetup", "");
  CHECK(lit(c, 0, 15) > 20 && lit(c, 16, 32) > 20, "NO SETUP");
}

int main() {
  round_trip();
  missing_fields_keep_defaults();
  usable();
  choose();
  status_screens();
  printf("%d checks, %d failed\n", g_checks, g_failed);
  return g_failed ? 1 : 0;
}
