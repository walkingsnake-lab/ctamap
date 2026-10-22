// Line-by-line port of firmware/boardlib/draw.py; see draw.h. Sections and
// function names follow draw.py.

#include "draw.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>

#include "assets.h"

namespace draw {

// ---- basics ----

double jsround(double x) { return floor(x + 0.5); }

long long fdiv(long long a, long long b) {
  long long q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

long long fmod_floor(long long a, long long b) {
  long long m = a % b;
  if (m != 0 && ((m < 0) != (b < 0))) m += b;
  return m;
}

ustr U(const std::string &s) {
  ustr out;
  size_t i = 0, n = s.size();
  while (i < n) {
    uint8_t c = (uint8_t)s[i];
    uint32_t cp;
    int extra;
    if (c < 0x80) { cp = c; extra = 0; }
    else if ((c >> 5) == 6) { cp = c & 0x1F; extra = 1; }
    else if ((c >> 4) == 14) { cp = c & 0x0F; extra = 2; }
    else if ((c >> 3) == 30) { cp = c & 0x07; extra = 3; }
    else { cp = 0xFFFD; extra = 0; }
    i++;
    for (int k = 0; k < extra && i < n; k++, i++) cp = (cp << 6) | ((uint8_t)s[i] & 0x3F);
    out += (char32_t)cp;
  }
  return out;
}

ustr U(const char *s) { return U(std::string(s)); }

std::string utf8(const ustr &s) {
  std::string out;
  for (char32_t cp : s) {
    if (cp < 0x80) out += (char)cp;
    else if (cp < 0x800) { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
    else { out += (char)(0xF0 | (cp >> 18)); out += (char)(0x80 | ((cp >> 12) & 0x3F)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
  }
  return out;
}

ustr num_text(long long n) {
  char buf[24];
  snprintf(buf, sizeof buf, "%lld", n);
  return U(buf);
}

static ustr vstr(const Value &v) { return U(json::str(v)); }
static ustr g(uint32_t cp) { return ustr(1, (char32_t)cp); }
static RGB hexs(const std::string &s) {
  // '#rrggbb'
  if (s.size() < 7) return RGB{};
  return hexc((uint32_t)strtoul(s.c_str() + 1, nullptr, 16));
}
static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---- packed fonts (assets.h) ----

static int glyph(Font font, uint32_t cp) {
  const uint8_t *t;
  uint32_t i;
  if (cp >= assets::LOW0 && cp < assets::LOW0 + 224) {
    t = assets::FONT_LOW[font];
    i = (cp - assets::LOW0) << 1;
  } else if (cp >= assets::PUA && cp < assets::PUA + 16) {
    t = assets::FONT_PUA[font];
    i = (cp - assets::PUA) << 1;
  } else {
    return -1;
  }
  int o = (t[i] << 8) | t[i + 1];
  return o == 0xFFFF ? -1 : o;
}

static int glyph_row(const uint8_t *d, int o, int r) {
  if (d[o + 1] > 8) {
    int p = o + 5 + (r << 1);
    return (d[p] << 8) | d[p + 1];
  }
  return d[o + 5 + r];
}

int measure(Font font, const ustr &s) {
  const uint8_t *d = assets::FONT_DATA[font];
  int w = 0;
  for (char32_t ch : s) {
    int o = glyph(font, ch);
    if (o >= 0) w += d[o];
  }
  return w > 0 ? w - 1 : 0;
}

// ---- frame ----

void Frame::clear() {
  for (int i = 0; i < W * H * 3; i++) px[i] = 0;
  clip_.on = false;
  clips_.clear();
}

void Frame::set(int x, int y, RGB c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  if (clip_.on && (x < clip_.x0 || y < clip_.y0 || x > clip_.x1 || y > clip_.y1)) return;
  int i = (y * W + x) * 3;
  px[i] = c.r;
  px[i + 1] = c.g;
  px[i + 2] = c.b;
}

RGB Frame::get(int x, int y) const {
  int i = (y * W + x) * 3;
  return RGB{px[i], px[i + 1], px[i + 2]};
}

void Frame::fill(int x, int y, int w, int h, RGB c) {
  for (int j = y; j < y + h; j++)
    for (int i = x; i < x + w; i++) set(i, j, c);
}

void Frame::push_clip(int x0, int y0, int x1, int y1) {
  clips_.push_back(clip_);
  clip_ = Clip{true, x0, y0, x1, y1};
}

void Frame::pop_clip() {
  clip_ = clips_.back();
  clips_.pop_back();
}

int Frame::text(Font font, const ustr &s, int x, int baseline, RGB c) {
  const uint8_t *d = assets::FONT_DATA[font];
  for (char32_t ch : s) {
    int o = glyph(font, ch);
    if (o < 0) continue;
    int dw = d[o], w = d[o + 1], h = d[o + 2], xo = d[o + 3] - 128, yo = d[o + 4] - 128;
    int top = baseline - (yo + h);
    for (int r = 0; r < h; r++) {
      int bits = glyph_row(d, o, r);
      for (int col = 0; col < w; col++)
        if ((bits >> (w - 1 - col)) & 1) set(x + xo + col, top + r, c);
    }
    x += dw;
  }
  return x;
}

// ---- pure helpers ----

long long minutes_until(double t, double now) { return (long long)ceil((t - now) / 60); }

static ustr time_text(double t, double now, bool due = true) {
  long long m = minutes_until(t, now);
  if (m <= 1) return due ? U"DUE" : U"2";
  return num_text(m);
}

static ustr chrono_text(double t, double now, bool due = true) {
  long long m = minutes_until(t, now);
  if (m <= 1) return due ? U"DUE" : U"2m";
  return num_text(m) + U"m";
}

static int max_rows(bool has_header, bool has_weather, bool has_key = false) {
  return 5 - (has_header ? 1 : 0) - (has_weather ? 1 : 0) - (has_key ? 1 : 0);
}

static std::vector<int> key_row_tops(int n, bool band) {
  // Mirrors keyRowTops in draw.js.
  std::vector<int> out;
  if (n == 0) return out;
  int area_top = 6;
  int area_h = (band ? 24 : 31) - area_top + 1;
  int kp = n == 2 ? 8 : (n == 3 || n == 4) ? 6 : 6;
  int pitch = n == 1 ? 0 : std::min(kp, (int)fdiv(area_h - 5, n - 1));
  int top = area_top + std::max(0LL, fdiv(area_h - ((n - 1) * pitch + 5), 2));
  for (int i = 0; i < n; i++) out.push_back(top + i * pitch);
  return out;
}

static std::vector<int> row_tops_base(int n, bool has_header, bool has_weather) {
  std::vector<int> out;
  if (n == 0) return out;
  if (!has_header) {
    if (!has_weather && n == 4) return {1, 9, 17, 25};
    int area_h = has_weather ? 26 : 32;
    int gap = std::max(1, (int)jsround((double)(area_h - 5 * n) / (n + 1)));
    int top = (int)fdiv(area_h - 5 * n - (n - 1) * gap, 2);
    for (int i = 0; i < n; i++) out.push_back(top + i * (5 + gap));
    return out;
  }
  if (has_header && !has_weather && n == 4) return {9, 15, 21, 27};
  if (has_header && !has_weather && n == 3) return {10, 18, 26};
  if (has_header && !has_weather && n == 2) return {13, 23};
  int area_top = 9;
  int area_bottom = has_weather ? 25 : 31;
  int area_h = area_bottom - area_top + 1;
  int preferred = (n == 2 || n == 3) ? 8 : 6;
  int pitch = n == 1 ? 0 : std::min(preferred, (int)fdiv(area_h - 5, n - 1));
  int block = (n - 1) * pitch + 5;
  int top = area_top + std::max(0LL, fdiv(area_h - block, 2));
  for (int i = 0; i < n; i++) out.push_back(top + i * pitch);
  return out;
}

// Mirrors rowTops in draw.js: without the header's divider line, the
// header layouts move up so the gap under the header matches the rest.
static std::vector<int> row_tops(int n, bool has_header, bool has_weather, bool divider = false, bool key = false) {
  if (key) return key_row_tops(n, has_header);
  if (has_header && !has_weather && n == 2) return divider ? std::vector<int>{12, 21} : std::vector<int>{10, 19};
  std::vector<int> tops = row_tops_base(n, has_header, has_weather);
  if (!has_header || divider || tops.empty()) return tops;
  int shift = (!has_weather && n <= 2) ? 2 : 1;
  for (int &t : tops) t -= shift;
  return tops;
}

bool is_shown(double x, double now, const Value &pnow) {
  return x >= now - DROP_GRACE ||
         (!pnow.is_null() && pnow.num() < x + DROP_GRACE && x >= now - DROP_GRACE - HOLD_MAX);
}

struct LiveRow {
  const Value *src;
  std::vector<const Value *> t;  // the shown times (payload values)
  std::vector<double> tn;
  std::vector<double> s;
};

static std::vector<LiveRow> live_rows(const Value &p, double now) {
  std::vector<LiveRow> out;
  const Value &pnow = p["now"];
  const Value &rows = p["rows"];
  for (size_t ri = 0; ri < rows.size(); ri++) {
    const Value &r = rows[ri];
    LiveRow lr;
    lr.src = &r;
    const Value &rs = r["s"];
    const Value &ts = r["t"];
    for (size_t i = 0; i < ts.size(); i++) {
      double x = ts[i].num();
      if (is_shown(x, now, pnow)) {
        lr.t.push_back(&ts[i]);
        lr.tn.push_back(x);
        lr.s.push_back(rs.truthy() ? rs[i].num() : 0);
      }
    }
    if (!lr.t.empty()) out.push_back(lr);
  }
  return out;
}

static std::vector<const Value *> live_ticker(const Value &p, double now) {
  std::vector<const Value *> out;
  const Value &pnow = p["now"];
  const Value &tk = p["ticker"];
  for (size_t i = 0; i < tk.size(); i++)
    if (is_shown(tk[i]["t"].num(), now, pnow)) out.push_back(&tk[i]);
  return out;
}

double ease_in_out(double x) { return x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2; }

RGB scale_color(RGB c, double k) {
  return RGB{(uint8_t)jsround(c.r * k), (uint8_t)jsround(c.g * k), (uint8_t)jsround(c.b * k)};
}

RGB fade(RGB c, double alpha) { return alpha >= 1 ? c : scale_color(c, std::max(0.0, alpha)); }

// ---- colors ----

RGB line_color(const std::string &ln) {
  if (ln == "RD") return hexc(0xc60c30);
  if (ln == "BL") return hexc(0x00a1de);
  if (ln == "BR") return hexc(0x62361b);
  if (ln == "GR") return hexc(0x009b3a);
  if (ln == "OR") return hexc(0xf9461c);
  if (ln == "PR") return hexc(0x522398);
  if (ln == "PK") return hexc(0xe27ea6);
  if (ln == "YL") return hexc(0xf9e300);
  return C::grey;
}

static const int TIME_GAP = 3, TIGHT_GAP = 2, LABEL_GAP = 3, TAG_GAP = 3, ROLL_DIST = 6;

Timing timing(const Value &p) {
  const Value &a = p["anim"];
  auto pick = [&](const char *k, double def) {
    const Value &v = a[k];
    return v.truthy() ? v.num(def) : def;
  };
  return Timing{pick("pageHold", 8000), pick("slide", 1200), pick("radarFrame", 500), pick("radarHold", 4000),
                pick("game", 60)};
}

// Precip fills at ~65%; the greens at 70% of that. rb (percent) scales all
// precip. Mirrors radarColors() in draw.js.
struct RadarColors {
  bool on[16] = {false};
  RGB c[16];
};

static RadarColors radar_colors(double rb) {
  static const struct { int v; uint32_t c; double trim; } BASE[] = {
      {1, 0x1f8f1f, 0.7}, {2, 0x2ee02e, 0.7}, {3, 0xffe000, 1}, {4, 0xff8c00, 1},
      {5, 0xff1a1a, 1},   {8, 0x4f86ff, 1},   {9, 0xa9c9ff, 1}, {10, 0xffffff, 1}};
  RadarColors out;
  out.on[6] = true;
  out.c[6] = hexc(0x34485e);
  out.on[7] = true;
  out.c[7] = hexc(0xffffff);
  for (const auto &b : BASE) {
    out.on[b.v] = true;
    out.c[b.v] = scale_color(hexc(b.c), 0.65 * b.trim * rb / 100);
  }
  return out;
}

static int rtext(Frame &f, Font font, const ustr &s, int right, int base, RGB c) {
  return f.text(font, s, right - measure(font, s) + 1, base, c);
}

static int ctext(Frame &f, Font font, const ustr &s, int cx, int base, RGB c) {
  return f.text(font, s, cx - (int)fdiv(measure(font, s), 2), base, c);
}

struct Box {
  int x0;
  bool has_y;
  int y0, x1, y1;
};

static Box text_box(Font font, const ustr &s, int x, int base) {
  const uint8_t *d = assets::FONT_DATA[font];
  Box b{x, false, 0, x + measure(font, s) - 1, 0};
  for (char32_t ch : s) {
    int o = glyph(font, ch);
    if (o >= 0 && d[o + 1] && d[o + 2]) {
      int yo = d[o + 4] - 128;
      int top = base - (yo + d[o + 2]);
      int bottom = base - yo - 1;
      if (!b.has_y) {
        b.y0 = top;
        b.y1 = bottom;
        b.has_y = true;
      } else {
        b.y0 = std::min(b.y0, top);
        b.y1 = std::max(b.y1, bottom);
      }
    }
  }
  return b;
}

// ---- time (Chicago, via the payload's UTC offset) ----

static ustr clock_text(double t, double tzo) {
  long long lt = (long long)floor(t + tzo);
  long long h = fmod_floor(fdiv(lt, 3600), 24);
  long long m = fmod_floor(fdiv(lt, 60), 60);
  long long h12 = h % 12 ? h % 12 : 12;
  char buf[16];
  snprintf(buf, sizeof buf, "%lld:%02lld", h12, m);
  return U(buf);
}

static ustr ampm_text(double t, double tzo) {
  long long lt = (long long)floor(t + tzo);
  return fmod_floor(fdiv(lt, 3600), 24) >= 12 ? U"PM" : U"AM";
}

// ---- pieces ----

static int icon_index(const Value &name) {
  if (!name.is_str()) return -1;
  for (int i = 0; i < assets::ICONS_N; i++)
    if (name.s == assets::ICONS[i].name) return i;
  return -1;
}

static RGB icon_color(char code) {
  for (int i = 0; i < assets::ICON_PALETTE_N; i++)
    if (assets::ICON_PALETTE[i].code == code)
      return RGB{assets::ICON_PALETTE[i].r, assets::ICON_PALETTE[i].g, assets::ICON_PALETTE[i].b};
  return RGB{};
}

static void draw_icon(Frame &f, int icon, int x, int y) {
  const char *px = assets::ICONS[icon].px;
  for (int j = 0; j < 8; j++)
    for (int i = 0; i < 8; i++) {
      char c = px[j * 8 + i];
      if (c != '.') f.fill(x + i, y + j, 1, 1, icon_color(c));
    }
}

// ---- clock rolls (the header clock, the radar's current time) ----

static NumRoller *g_roller = nullptr;
static const Rolls *g_nums = nullptr;

static std::optional<Roll> take_roll(const std::string &name, const ustr &text) {
  if (g_roller) return g_roller->take(name, text);
  if (g_nums && !g_nums->empty()) {
    auto it = g_nums->find(name);
    if (it != g_nums->end() && it->second.p < 1 && it->second.from != text) return it->second;
  }
  return std::nullopt;
}

// Digit roll metrics per font: travel, and the digits' ink rows relative to
// the baseline (the clip). fontRoll() in draw.js computes these.
struct RollFont {
  int dist, t0, t1;
};
static RollFont roll_font(Font font) { return font == FONT_5X7 ? RollFont{7, -6, -1} : RollFont{6, -5, -1}; }

static bool same_shape(Font font, const ustr &a, const ustr &b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); i++)
    if (measure(font, a.substr(i, 1)) != measure(font, b.substr(i, 1))) return false;
  return true;
}

// Text right-aligned at `right` that rolls when it changes. Pixel-identical
// to rollTextWith() in draw.js. Returns x after the last advance.
static int roll_text(Frame &f, Font font, const ustr &text, int right, int base, RGB color,
                     const std::optional<Roll> &roll) {
  int x = right - measure(font, text) + 1;
  if (!roll) return f.text(font, text, x, base, color);
  const ustr &frm = roll->from;
  RollFont rf = roll_font(font);
  int up = (int)jsround(ease_in_out(roll->p) * rf.dist);
  int fx = right - measure(font, frm) + 1;
  f.push_clip(0, base + rf.t0, 63, base + rf.t1);
  if (fx == x && same_shape(font, text, frm)) {
    for (size_t i = 0; i < text.size(); i++) {
      ustr ch = text.substr(i, 1);
      if (text[i] == frm[i]) {
        f.text(font, ch, x, base, color);
      } else {
        f.text(font, frm.substr(i, 1), x, base - up, color);
        f.text(font, ch, x, base - up + rf.dist, color);
      }
      x += measure(font, ch) + 1;
    }
    f.pop_clip();
    return x;
  }
  f.text(font, frm, fx, base - up, color);
  x = f.text(font, text, x, base - up + rf.dist, color);
  f.pop_clip();
  return x;
}

void NumRoller::begin(double ms) {
  t_ = ms;
  cur_.clear();
}

std::optional<Roll> NumRoller::take(const std::string &name, const ustr &text) {
  cur_[name] = text;
  auto old = prev_.find(name);
  if (old != prev_.end() && old->second != text) live_[name] = Live{old->second, t_};
  auto r = live_.find(name);
  if (r == live_.end()) return std::nullopt;
  double p = (t_ - r->second.start) / ROLL_MS;
  if (p >= 1 || r->second.from == text) {
    live_.erase(r);
    return std::nullopt;
  }
  return Roll{r->second.from, p};
}

void NumRoller::end() {
  for (auto it = live_.begin(); it != live_.end();) {
    if (cur_.find(it->first) == cur_.end()) it = live_.erase(it);
    else ++it;
  }
  std::swap(prev_, cur_);
}

void NumRoller::reset() {
  prev_.clear();
  live_.clear();
}

bool NumRoller::busy(double ms) const {
  for (const auto &kv : live_)
    if (ms - kv.second.start < ROLL_MS) return true;
  return false;
}

bool NumRoller::clock() const {
  for (const auto &kv : prev_) {
    const std::string &k = kv.first;
    if (k.size() >= 5 && k.compare(k.size() - 5, 5, "clock") == 0) return true;
  }
  return false;
}

// Station name + clock on rows 1-5, flush to the screen edges, both in
// `color`. `divider`: a line on row 7 (transit).
static void draw_header(Frame &f, const ustr &name, double now, double tzo, bool divider = false, bool clock = true,
                        RGB color = C::head) {
  f.text(FONT_SMALL, name, 0, 6, color);
  if (clock) {
    ustr ck = clock_text(now, tzo);
    roll_text(f, FONT_SMALL, ck, 63, 6, color, take_roll("hdr.clock", ck));
  }
  if (divider) f.fill(0, 7, 64, 1, C::divider);
}

struct WarnStyle {
  ustr glyph;
  RGB color;
  bool blinks;
};

static WarnStyle warn_style(const Value &warn) {
  bool tor = warn["kind"].eq("tor");
  WarnStyle ws;
  ws.glyph = g(tor ? assets::G_FUNNEL : assets::G_BOLT);
  if (warn["lvl"].eq("watch")) ws.color = C::watch;
  else ws.color = tor ? C::warnTornado : C::warnSevere;
  ws.blinks = tor && warn["lvl"].eq("warning");
  return ws;
}

// Weather strip: one Tom Thumb line on rows 27-31. Mirrors drawWeather() in draw.js.
static void draw_weather(Frame &f, const Value &wx, const Value *warn, bool blink) {
  int base = 32;
  f.text(FONT_SMALL, vstr(wx["temp"]) + U"°", 0, base, C::dimHead);
  if (warn) {
    WarnStyle ws = warn_style(*warn);
    if (ws.blinks && blink) return;
    ustr word = (*warn)["lvl"].eq("warning") ? U"WARNING" : U"WATCH";
    int x = 63 - (measure(FONT_SMALL, ws.glyph) + TAG_GAP + measure(FONT_SMALL, word)) + 1;
    f.text(FONT_SMALL, word, f.text(FONT_SMALL, ws.glyph, x, base, ws.color) + TAG_GAP - 1, base, ws.color);
  } else if (wx["word"].truthy()) {
    rtext(f, FONT_SMALL, vstr(wx["word"]), 63, base, C::dimHead);
  }
}

// Key layout: the key on rows 1-5, the station and clock on rows 27-31 under
// a divider on row 25. Mirrors drawKey() / drawBand() in draw.js.
static void draw_key(Frame &f) {
  f.text(FONT_SMALL, U"trains to", 0, 6, C::dimHead);
  rtext(f, FONT_SMALL, U"min", 63, 6, C::dimHead);
}

static void draw_band(Frame &f, const ustr &name, double now, double tzo, bool clock = true) {
  f.fill(0, 25, 64, 1, C::divider);
  f.text(FONT_SMALL, name, 0, 32, C::head);
  if (clock) {
    ustr ck = clock_text(now, tzo);
    roll_text(f, FONT_SMALL, ck, 63, 32, C::head, take_roll("hdr.clock", ck));
  }
}

static bool is_num(ustr s) {
  if (s.empty()) return false;
  if (s.back() == U'm') s.pop_back();
  if (s.empty()) return false;
  for (char32_t ch : s)
    if (ch < U'0' || ch > U'9') return false;
  return true;
}

// One time cell, right-aligned at `right`, optionally mid-roll.
// Same-length numbers roll only the digits that changed.
static void draw_time_cell(Frame &f, const ustr &text, int right, int top, RGB color, const std::optional<Roll> &roll) {
  int base = top + 5;
  if (!roll || roll->from == text || roll->p >= 1) {
    rtext(f, FONT_SMALL, text, right, base, color);
    return;
  }
  int up = (int)jsround(ease_in_out(roll->p) * ROLL_DIST);
  f.push_clip(0, top, 63, top + 4);
  const ustr &frm = roll->from;
  if (frm.size() == text.size() && is_num(frm) && is_num(text)) {
    int x = right - measure(FONT_SMALL, text) + 1;
    for (size_t i = 0; i < text.size(); i++) {
      if (frm[i] == text[i]) {
        f.text(FONT_SMALL, text.substr(i, 1), x, base, color);
      } else {
        f.text(FONT_SMALL, frm.substr(i, 1), x, base - up, color);
        f.text(FONT_SMALL, text.substr(i, 1), x, base - up + ROLL_DIST, color);
      }
      x += measure(FONT_SMALL, text.substr(i, 1)) + 1;
    }
  } else {
    rtext(f, FONT_SMALL, frm, right, base - up, color);
    rtext(f, FONT_SMALL, text, right, base - up + ROLL_DIST, color);
  }
  f.pop_clip();
}

// steps: the third time a step dimmer than the second (payload ts).
static std::vector<ViewCell> layout_cells(const LiveRow &r, double now, bool steps = false) {
  std::vector<ustr> texts;
  for (size_t k = 0; k < r.tn.size(); k++) texts.push_back(time_text(r.tn[k], now, k == 0));
  auto width_at = [&](int gap) {
    int w = 0;
    for (size_t i = 0; i < texts.size(); i++) w += measure(FONT_SMALL, texts[i]) + (i ? gap : 0);
    return w;
  };
  ustr lbl = vstr((*r.src)["lbl"]);
  int label_end = 5 + measure(FONT_SMALL, lbl) - 1;
  int gap = 63 - width_at(TIME_GAP) + 1 - label_end - 1 >= LABEL_GAP ? TIME_GAP : TIGHT_GAP;
  std::vector<ViewCell> cells(texts.size());
  int x = 63;
  for (int k = (int)texts.size() - 1; k >= 0; k--) {
    bool sch = r.s[k] != 0;
    RGB color = sch ? (k == 0 ? C::sch : steps && k >= 2 ? C::schDim2 : C::schDim)
                    : (k == 0 ? C::amber : steps && k >= 2 ? C::dimAmber2 : C::dimAmber);
    ViewCell &c = cells[k];
    c.t = r.tn[k];
    c.text = texts[k];
    c.right = x;
    c.alpha = 1;
    c.color = color;
    x -= measure(FONT_SMALL, texts[k]) + gap;
  }
  return cells;
}

static View view_base(const Value &p, double now) {
  View v;
  v.now = now;
  v.has_header = p["header"].truthy();
  if (v.has_header) v.header = vstr(p["header"]);
  v.wx = p["wx"].truthy() ? &p["wx"] : nullptr;
  v.warn = p["warn"].truthy() ? &p["warn"] : nullptr;
  v.hdiv = p["headerDivider"].is_true();
  v.key = p["key"].truthy();
  v.clock = !p["hclock"].is_false();
  v.lnc = p["lnc"].is_true();
  v.stale = p["stale"].truthy();
  v.tzo = p["tzo"].num(0);
  return v;
}

static View build_chrono_view(const Value &p, double now);

View build_transit_view(const Value &p, double now) {
  if (p["view"].eq("chrono")) return build_chrono_view(p, now);
  std::vector<LiveRow> rows = live_rows(p, now);
  std::vector<int> tops = row_tops((int)rows.size(), p["header"].truthy(), p["wx"].truthy(),
                                   p["headerDivider"].is_true(), p["key"].truthy());
  View v = view_base(p, now);
  v.mode = "dest";
  for (size_t i = 0; i < rows.size(); i++) {
    const Value &r = *rows[i].src;
    ViewRow vr;
    vr.ln = r["ln"].str_or("");
    vr.lbl = vstr(r["lbl"]);
    vr.key = vr.ln + ":" + utf8(vr.lbl);
    vr.a = r["a"].truthy();
    vr.top = tops[i];
    vr.alpha = 1;
    vr.cells = layout_cells(rows[i], now, p["ts"].is_true());
    v.rows.push_back(vr);
  }
  return v;
}

static View build_chrono_view(const Value &p, double now) {
  // Sorted here too, by time (stable). Mirrors buildChronoView in draw.js.
  std::vector<LiveRow> rows = live_rows(p, now);
  std::stable_sort(rows.begin(), rows.end(), [](const LiveRow &a, const LiveRow &b) { return a.tn[0] < b.tn[0]; });
  size_t cap = (size_t)std::max(0, max_rows(p["header"].truthy(), p["wx"].truthy(), p["key"].truthy()));
  if (rows.size() > cap) rows.resize(cap);
  std::vector<int> tops = row_tops((int)rows.size(), p["header"].truthy(), p["wx"].truthy(),
                                   p["headerDivider"].is_true(), p["key"].truthy());
  View v = view_base(p, now);
  v.mode = "chrono";
  v.pitch = tops.size() > 1 ? tops[1] - tops[0] : 6;
  std::vector<std::string> seen_dest, seen_key;
  auto seen = [](const std::vector<std::string> &s, const std::string &k) {
    return std::find(s.begin(), s.end(), k) != s.end();
  };
  for (size_t i = 0; i < rows.size(); i++) {
    const Value &r = *rows[i].src;
    std::string ln = r["ln"].str_or("");
    std::string lbl = json::str(r["lbl"]);
    std::string dest = ln + ":" + lbl;
    bool due = !seen(seen_dest, dest);
    seen_dest.push_back(dest);
    std::string key = !r["rn"].is_null() ? "rn:" + json::str(r["rn"]) : ln + ":" + lbl + ":" + json::str(*rows[i].t[0]);
    if (seen(seen_key, key)) key += "#" + std::to_string(i);
    seen_key.push_back(key);
    bool sch = rows[i].s[0] != 0;
    RGB color = sch ? (i ? C::schDim : C::sch) : (i ? C::dimAmber : C::amber);
    ViewRow vr;
    vr.key = key;
    vr.ln = ln;
    vr.lbl = U(lbl);
    vr.a = r["a"].truthy();
    vr.num = (int)i + 1;
    vr.top = tops[i];
    vr.alpha = 1;
    ViewCell c;
    c.t = rows[i].tn[0];
    c.text = chrono_text(rows[i].tn[0], now, due);
    c.right = 63;
    c.alpha = 1;
    c.color = color;
    vr.cells.push_back(c);
    v.rows.push_back(vr);
  }
  return v;
}

// Chronological rows: digit in columns 0-2, the 3px line-color block at
// CHRONO_BLOCK_X (1px gap), the label 2px after it.
static const int CHRONO_BLOCK_X = 4, CHRONO_LABEL_X = 9;
// A line with a major alert: its block at ALERT_DIM of the line color, the
// "!" over it in the full color. Mirrors LINE_ALERT in draw.js.
static const double ALERT_DIM = 0.2;

static void draw_view_row(Frame &f, const ViewRow &row, bool lnc) {
  int top = (int)jsround(row.top);
  bool chrono = row.num.has_value();
  RGB lc = line_color(row.ln);
  RGB line = fade(lc, row.alpha);
  if (chrono) draw_time_cell(f, num_text(*row.num), 2, top, fade(lc, row.alpha), row.numRoll);
  int bx = chrono ? CHRONO_BLOCK_X : 0;
  if (row.a) {
    f.fill(bx, top, 3, 5, fade(scale_color(lc, ALERT_DIM), row.alpha));
    for (int j = 0; j < assets::ALERT_BANG_N; j++)
      for (int i = 0; assets::ALERT_BANG[j][i]; i++)
        if (assets::ALERT_BANG[j][i] == '#') f.fill(bx + i, top + j, 1, 1, line);
  } else {
    f.fill(bx, top, 3, 5, line);
  }
  f.text(FONT_SMALL, row.lbl, chrono ? CHRONO_LABEL_X : 5, top + 5, fade(lnc ? lc : C::label, row.alpha));
  for (const ViewCell &cell : row.cells) {
    double a = cell.alpha * row.alpha;
    if (a <= 0) continue;
    draw_time_cell(f, cell.text, (int)jsround(cell.right), top, fade(cell.color, a), cell.roll);
  }
}

static void draw_overnight(Frame &f, const View &view, double now) {
  ustr clock = clock_text(now, view.tzo);
  ustr nt = view.stale ? U"NO DATA" : U"NO TRAINS";
  int block_h = 10 + 3 + 5;
  int area_h = view.wx ? 26 : 32;
  int top = (int)fdiv(area_h - block_h, 2);
  f.text(FONT_CLOCK, clock, (int)fdiv(64 - measure(FONT_CLOCK, clock), 2), top + 10, C::clock);
  f.text(FONT_SMALL, nt, (int)fdiv(64 - measure(FONT_SMALL, nt), 2), top + 18, C::noTrains);
}

static void draw_stale(Frame &f, const Value &p) {
  if (p["stale"].truthy()) f.fill(0, 0, 64, 1, C::red);
}

static void draw_transit_view(Frame &f, const View &view, bool blink) {
  if (view.rows.empty()) {
    draw_overnight(f, view, view.now);
  } else {
    if (view.key) {
      draw_key(f);
      if (view.has_header) draw_band(f, view.header, view.now, view.tzo, view.clock);
    } else if (view.has_header) {
      draw_header(f, view.header, view.now, view.tzo, view.hdiv, view.clock, C::dimHead);
    }
    int clip_top = view.key ? 6 : (view.has_header ? 7 : 0);
    int clip_bottom = (view.key && view.has_header) ? 24 : (view.wx ? 25 : 31);
    f.push_clip(0, clip_top, 63, clip_bottom);
    for (const ViewRow &row : view.rows) draw_view_row(f, row, view.lnc);
    f.pop_clip();
  }
  if (view.wx) draw_weather(f, *view.wx, view.warn, blink);
}

static void render_transit(const Value &p, Frame &f, std::optional<double> now, bool blink, const View *view) {
  double n = now ? *now : p["now"].num();
  if (view) {
    draw_transit_view(f, *view, blink);
  } else {
    View v = build_transit_view(p, n);
    draw_transit_view(f, v, blink);
  }
  draw_stale(f, p);
}

// ---- transit animation (createTransitAnimator) ----

static double lerp(double a, double b, double k) { return a + (b - a) * k; }

static RGB lerp_color(RGB c1, RGB c2, double k) {
  if (k >= 1 || c1 == c2) return c2;
  return RGB{(uint8_t)jsround(lerp(c1.r, c2.r, k)), (uint8_t)jsround(lerp(c1.g, c2.g, k)),
             (uint8_t)jsround(lerp(c1.b, c2.b, k))};
}

static double clamp01(double x) { return std::max(0.0, std::min(1.0, x)); }

static double tween(double frm, double to, double start, double dur, double t) {
  if (t <= start) return frm;
  if (t >= start + dur) return to;
  return lerp(frm, to, ease_in_out((t - start) / dur));
}

// Python truthiness of an optional number (0 is falsy, like JS).
static bool tr(const std::optional<double> &v) { return v.has_value() && *v != 0; }

using CellP = TransitAnimator::CellP;
using RowP = TransitAnimator::RowP;

static std::vector<CellP> pair_cells(const std::vector<CellP> &old, const std::vector<ViewCell> &cells) {
  size_t n = old.size(), m = cells.size();
  std::vector<std::vector<double>> cost(n + 1, std::vector<double>(m + 1, 0));
  enum Pick { NONE, OLD, NEW, PAIR };
  std::vector<std::vector<int>> how(n + 1, std::vector<int>(m + 1, NONE));
  for (int i = (int)n; i >= 0; i--) {
    for (int j = (int)m; j >= 0; j--) {
      if ((size_t)i == n || (size_t)j == m) {
        cost[i][j] = (double)((n - i) + (m - j)) * MATCH_S;
        continue;
      }
      double best = cost[i + 1][j] + MATCH_S;
      int pick = OLD;
      if (cost[i][j + 1] + MATCH_S < best) {
        best = cost[i][j + 1] + MATCH_S;
        pick = NEW;
      }
      double d = fabs(old[i]->t - cells[j].t);
      if (d <= MATCH_S && cost[i + 1][j + 1] + d < best) {
        best = cost[i + 1][j + 1] + d;
        pick = PAIR;
      }
      cost[i][j] = best;
      how[i][j] = pick;
    }
  }
  std::vector<CellP> out(m);
  size_t i = 0, j = 0;
  while (i < n && j < m) {
    if (how[i][j] == PAIR) {
      out[j] = old[i];
      i++;
      j++;
    } else if (how[i][j] == OLD) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

static bool contains(const std::vector<CellP> &lst, const CellP &c) {
  return std::find(lst.begin(), lst.end(), c) != lst.end();
}

TransitAnimator::RowP TransitAnimator::find(const std::string &key) const {
  for (const auto &kv : rows)
    if (kv.first == key) return kv.second;
  return nullptr;
}

void TransitAnimator::erase(const std::string &key) {
  for (auto it = rows.begin(); it != rows.end(); ++it)
    if (it->first == key) {
      rows.erase(it);
      return;
    }
}

void TransitAnimator::match_cells(RowState &state, const std::vector<ViewCell> &cells, double t, bool is_new_row) {
  std::vector<CellP> unmatched;
  for (const CellP &c : state.cells)
    if (!tr(c->leaving)) unmatched.push_back(c);
  std::vector<CellP> pairs = pair_cells(unmatched, cells);
  std::vector<CellP> used, out, moved, joined;
  for (size_t j = 0; j < cells.size(); j++) {
    const ViewCell &c = cells[j];
    const CellP &m = pairs[j];
    if (m) {
      used.push_back(m);
      if (m->text != c.text) {
        m->has_roll = true;
        m->roll_from = m->text;
        m->roll_start = t;
      }
      if (m->color != c.color) {
        m->fromColor = m->shownColor ? *m->shownColor : m->color;
        m->colorStart = t;
      }
      if (m->right != c.right) {
        m->fromRight = m->shownRight ? *m->shownRight : m->right;
        m->moveStart = t;
        moved.push_back(m);
      }
      m->t = c.t;
      m->text = c.text;
      m->color = c.color;
      m->right = c.right;
      out.push_back(m);
    } else {
      CellP n = std::make_shared<CellState>();
      n->t = c.t;
      n->text = c.text;
      n->right = c.right;
      n->color = c.color;
      if (!is_new_row) n->born = t;
      if (!is_new_row) joined.push_back(n);
      out.push_back(n);
    }
  }
  for (const CellP &u : unmatched)
    if (!contains(used, u)) {
      u->leaving = t;
      out.push_back(u);
    }
  for (const CellP &c : state.cells)
    if (tr(c->leaving) && *c->leaving != t && t - *c->leaving < FADE_MS) out.push_back(c);
  std::vector<CellP> dedup;
  for (const CellP &c : out)
    if (!contains(dedup, c)) dedup.push_back(c);
  state.cells = dedup;
  // Cells slide and join only once the leaving ones have faded.
  double until = t;
  for (const CellP &c : state.cells)
    if (tr(c->leaving)) until = std::max(until, *c->leaving + FADE_MS);
  for (const CellP &mv : moved) mv->moveStart = until;
  for (const CellP &n : joined) n->born = until + (moved.empty() ? 0 : MOVE_MS);
}

View TransitAnimator::step(const Value &p, double now, double t) {
  View target = build_transit_view(p, now);
  bool chrono = target.mode == "chrono";
  std::vector<std::string> keys;
  for (const ViewRow &r : target.rows) keys.push_back(r.key);
  auto in_keys = [&](const std::string &k) { return std::find(keys.begin(), keys.end(), k) != keys.end(); };
  std::vector<RowP> current;
  for (const auto &kv : rows)
    if (!tr(kv.second->leaving)) current.push_back(kv.second);
  double first_top = INFINITY;
  for (const RowP &st : current) first_top = std::min(first_top, st->top);
  bool continuing = false;
  for (const RowP &st : current)
    if (in_keys(st->key)) {
      continuing = true;
      break;
    }
  double leaving_until = 0;
  std::vector<std::pair<std::string, RowP>> snapshot = rows;
  for (const auto &kv : snapshot) {
    const RowP &st = kv.second;
    if (!in_keys(kv.first) && !tr(st->leaving)) {
      st->leaving = t;
      if (chrono && st->mode == "chrono" && st->top == first_top) {
        st->fromTop = st->shownTop;
        st->top = st->top - target.pitch;
        st->moveStart = t;
      }
    }
    if (tr(st->leaving)) {
      if (t - *st->leaving >= FADE_MS) erase(kv.first);
      else if (!(chrono && st->mode == "chrono")) leaving_until = std::max(leaving_until, *st->leaving + FADE_MS);
    }
  }
  bool fresh = rows.empty();  // a fresh animator shows its rows at once
  for (const ViewRow &r : target.rows) {
    RowP st = find(r.key);
    bool is_new_row = !st || tr(st->leaving);
    if (is_new_row) {
      RowP ns = std::make_shared<RowState>();
      ns->key = r.key;
      ns->top = r.top;
      ns->shownTop = r.top;
      if (!fresh) ns->born = std::max(t, leaving_until);
      if (chrono && continuing) {
        ns->fromTop = r.top + target.pitch;
        ns->moveStart = t;
      }
      // A JS Map keeps a re-set key in its original position.
      bool replaced = false;
      for (auto &kv : rows)
        if (kv.first == r.key) {
          kv.second = ns;
          replaced = true;
          break;
        }
      if (!replaced) rows.emplace_back(r.key, ns);
      st = ns;
    } else if (st->top != r.top) {
      st->fromTop = st->shownTop;
      st->moveStart = std::max(t, leaving_until);
      st->top = r.top;
    }
    if (r.num && st->num && *st->num != *r.num && !is_new_row) {
      st->has_numRoll = true;
      st->numRoll_from = num_text(*st->num);
      st->numRoll_start = t;
    }
    st->ln = r.ln;
    st->lbl = r.lbl;
    st->a = r.a;
    st->num = r.num;
    st->mode = target.mode;
    match_cells(*st, r.cells, t, is_new_row);
  }

  View view = target;
  view.rows.clear();
  bool any_leaving = false;
  for (const auto &kv : rows)
    if (tr(kv.second->leaving)) any_leaving = true;
  if (target.rows.empty() && !any_leaving) {
    rows.clear();
    return view;
  }
  for (const auto &kv : rows) {
    RowState &st = *kv.second;
    st.shownTop = st.moveStart ? tween(*st.fromTop, st.top, *st.moveStart, MOVE_MS, t) : st.top;
    double alpha;
    if (tr(st.leaving)) alpha = 1 - clamp01((t - *st.leaving) / FADE_MS);
    else if (st.born) alpha = clamp01((t - *st.born) / FADE_MS);
    else alpha = 1;
    if (!tr(st.leaving) && alpha >= 1) st.born.reset();
    std::vector<ViewCell> cells;
    for (const CellP &cp : st.cells) {
      CellState &c = *cp;
      if (tr(c.leaving) && !(t - *c.leaving < FADE_MS)) continue;
      c.shownRight = c.moveStart ? tween(*c.fromRight, c.right, *c.moveStart, MOVE_MS, t) : c.right;
      if (c.colorStart) c.shownColor = lerp_color(*c.fromColor, c.color, ease_in_out(clamp01((t - *c.colorStart) / COLOR_MS)));
      else c.shownColor = c.color;
      double roll_p = c.has_roll ? (t - c.roll_start) / ROLL_MS : 1;
      if (roll_p >= 1) c.has_roll = false;
      double ca;
      if (tr(c.leaving)) ca = 1 - clamp01((t - *c.leaving) / FADE_MS);
      else if (c.born) ca = clamp01((t - *c.born) / FADE_MS);
      else ca = 1;
      ViewCell vc;
      vc.t = c.t;
      vc.text = c.text;
      vc.right = *c.shownRight;
      vc.color = *c.shownColor;
      vc.alpha = ca;
      if (c.has_roll) vc.roll = Roll{c.roll_from, roll_p};
      cells.push_back(vc);
    }
    std::vector<CellP> keep;
    for (const CellP &cp : st.cells)
      if (!tr(cp->leaving) || t - *cp->leaving < FADE_MS) keep.push_back(cp);
    st.cells = keep;
    double num_p = st.has_numRoll ? (t - st.numRoll_start) / ROLL_MS : 1;
    if (num_p >= 1) st.has_numRoll = false;
    ViewRow vr;
    vr.key = st.key;
    vr.ln = st.ln;
    vr.lbl = st.lbl;
    vr.a = st.a;
    vr.top = st.shownTop;
    vr.alpha = alpha;
    vr.cells = cells;
    vr.num = st.num;
    if (st.has_numRoll) vr.numRoll = Roll{st.numRoll_from, num_p};
    view.rows.push_back(vr);
  }
  return view;
}

// ---- ticker ----

static void draw_ticker_item(Frame &f, const Value &it, int idx, int top, double now, bool due, double fill) {
  int base = top + 9;
  RGB white = C::white;
  f.fill(0, top, 5, 12, C::index);
  f.fill(5, top, 59, 12, scale_color(line_color(it["ln"].str_or("")), fill));
  if (it["a"].truthy()) {
    f.text(FONT_SMALL, g(assets::G_ALERT_DISC), 0, base, C::red);
    f.text(FONT_SMALL, g(assets::G_ALERT_MARK), 0, base, C::white);
  } else if (it["s"].truthy()) {
    f.text(FONT_SMALL, g(assets::G_CLOCK), 0, base, C::label);
  } else {
    f.text(FONT_SMALL, num_text(idx), 1, base, C::label);
  }
  f.text(FONT_5X7, vstr(it["d"]), 7, base, white);
  long long m = minutes_until(it["t"].num(), now);
  if (m <= 1 && due) {
    rtext(f, FONT_5X7, U"Due", 62, base, white);
  } else {
    // A second train within a minute of the first shows 2, not Due.
    int mw = measure(FONT_5X7, g(assets::G_MIN));
    f.text(FONT_5X7, g(assets::G_MIN), 62 - mw + 1, base, white);
    rtext(f, FONT_5X7, num_text(m <= 1 ? 2 : m), 62 - mw - 2, base, white);
  }
}

int ticker_pages(const Value &p, double now) {
  long long n = (long long)live_ticker(p, now).size();
  return (int)std::max(1LL, -fdiv(-n, 2));
}

static void render_ticker(const Value &p, Frame &f, std::optional<double> now_o, int page, double slide) {
  double now = now_o ? *now_o : p["now"].num();
  const Value &th = p.has("tickerHeader") ? p["tickerHeader"] : p["header"];
  if (th.truthy()) draw_header(f, vstr(th), now, p["tzo"].num(0), false, !p["hclock"].is_false());
  std::vector<const Value *> items = live_ticker(p, now);
  double fill = (p["tickerFill"].truthy() ? p["tickerFill"].num() : 55) / 100;
  int pages = (int)std::max(1LL, -fdiv(-(long long)items.size(), 2));
  page = (int)fmod_floor(page, pages);
  int offset = (int)jsround(ease_in_out(std::min(1.0, std::max(0.0, slide))) * 26);

  // Only the soonest train per destination may read Due.
  std::vector<std::pair<std::string, size_t>> first_of;
  auto key_of = [](const Value &it) { return it["ln"].str_or("") + ":" + json::str(it["d"]); };
  for (size_t i = 0; i < items.size(); i++) {
    std::string k = key_of(*items[i]);
    bool found = false;
    for (auto &kv : first_of)
      if (kv.first == k) {
        found = true;
        if ((*items[i])["t"].num() < (*items[kv.second])["t"].num()) kv.second = i;
      }
    if (!found) first_of.emplace_back(k, i);
  }
  auto first = [&](const std::string &k) -> size_t {
    for (auto &kv : first_of)
      if (kv.first == k) return kv.second;
    return (size_t)-1;
  };
  auto draw_page = [&](int pg, int shift) {
    for (int i = 0; i < 2; i++) {
      size_t n = (size_t)(pg * 2 + i);
      if (n >= items.size()) break;
      const Value &it = *items[n];
      draw_ticker_item(f, it, (int)n + 1, 7 + i * 13 + shift, now, first(key_of(it)) == n, fill);
    }
  };
  f.push_clip(0, 7, 63, 31);
  draw_page(page, -offset);
  if (offset > 0 && pages > 1) draw_page((page + 1) % pages, 26 - offset);
  f.pop_clip();
  draw_stale(f, p);
}

// ---- weather screen (design spec §7) ----

static const RGB WX_BLUE = hexc(0x1e90ff);
static const char *const WX_DROP[] = {".#.", "###", "###", ".#."};

static ustr warn_text(const Value &warn) {
  bool tor = warn["kind"].eq("tor");
  bool warning = warn["lvl"].eq("warning");
  if (tor) return warning ? U"TORNADO WARN" : U"TORNADO WATCH";
  return warning ? U"TSTORM WARNING" : U"TSTORM WATCH";
}

static RGB temp_color(double t, const Value &c) {
  static const struct { double t; uint32_t c; } STOPS[] = {
      {-10, 0x3050ff}, {20, 0x40a0ff}, {40, 0x30d0d0}, {55, 0x40d040}, {70, 0xffd000}, {85, 0xff8000}, {100, 0xff2020}};
  // STOPS are F; c: the temperature is C (wx 'c').
  if (c.truthy()) t = floor(t * 9 / 5) + 32;
  if (t <= STOPS[0].t) return hexc(STOPS[0].c);
  for (int i = 1; i < 7; i++) {
    if (t <= STOPS[i].t) return lerp_color(hexc(STOPS[i - 1].c), hexc(STOPS[i].c), (t - STOPS[i - 1].t) / (STOPS[i].t - STOPS[i - 1].t));
  }
  return hexc(STOPS[6].c);
}

static void draw_weather_screen(Frame &f, const Value &wx, const Value *warn, bool blink, bool shadow) {
  double temp = wx["temp"].num();
  auto draw_temp = [&](int dx, int dy, RGB color) {
    int x = dx;
    if (temp < 0) {
      f.fill(x, 8 + dy, 5, 2, color);
      x += 7;
    }
    x = f.text(FONT_CLOCK, U(json::num_str(fabs(temp), wx["temp"].is_int)), x, 14 + dy, color);
    f.fill(x, 4 + dy, 3, 1, color);
    f.fill(x, 6 + dy, 3, 1, color);
    f.fill(x, 5 + dy, 1, 1, color);
    f.fill(x + 2, 5 + dy, 1, 1, color);
    return x + 2;
  };
  if (shadow) draw_temp(1, 1, scale_color(temp_color(temp, wx["c"]), 0.2));
  int temp_right = draw_temp(0, 0, C::label) + (shadow ? 1 : 0);
  int icon = icon_index(wx["icon"]);
  if (icon >= 0) draw_icon(f, icon, 55, 1);
  const Value &word = wx["word"];
  if (word.truthy() && 63 - measure(FONT_SMALL, vstr(word)) + 1 > temp_right + 2)
    rtext(f, FONT_SMALL, vstr(word), 63, 16, C::wxText);
  f.fill(0, 18, 64, 1, C::divider);
  if (!wx["feels"].is_null()) f.text(FONT_SMALL, U"FEELS " + vstr(wx["feels"]) + U"°", 0, 25, C::grey);
  if (wx["wind"].truthy()) rtext(f, FONT_SMALL, vstr(wx["wind"]), 63, 25, C::label);
  if (warn) {
    WarnStyle ws = warn_style(*warn);
    if (!(ws.blinks && blink)) {
      int gx = f.text(FONT_SMALL, ws.glyph, 0, 31, ws.color);
      f.text(FONT_SMALL, warn_text(*warn), gx + TAG_GAP - 1, 31, ws.color);
    }
    return;
  }
  int pop_left = 64;
  if (!wx["pop"].is_null()) {
    ustr t = vstr(wx["pop"]) + U"%";
    int px = 63 - measure(FONT_SMALL, t) + 1;
    f.text(FONT_SMALL, t, px, 31, C::label);
    for (int j = 0; j < 4; j++)
      for (int i = 0; WX_DROP[j][i]; i++)
        if (WX_DROP[j][i] == '#') f.fill(px - 5 + i, 27 + j, 1, 1, WX_BLUE);
    pop_left = px - 5;
  }
  if (!wx["hi"].is_null() && !wx["lo"].is_null()) {
    ustr hl = U"H " + vstr(wx["hi"]) + U"° L " + vstr(wx["lo"]) + U"°";
    if (measure(FONT_SMALL, hl) + 3 > pop_left) hl = U"H " + vstr(wx["hi"]) + U" L " + vstr(wx["lo"]);
    f.text(FONT_SMALL, hl, 0, 31, C::grey);
  }
}

// ---- 5-day layout ----

static const RGB FD_LETTER = hexc(0x4a4a4a);
static const RGB FD_NUM = C::grey;
static const int FD_PITCH = 13, FD_ICON_X = 1, FD_HL_RIGHT = 62, FD_TEMP_X = FD_ICON_X + 10;

static bool tight_temp(const ustr &s) { return s.size() >= 3 || (!s.empty() && s[0] == U'-'); }
static int tight_adv(char32_t ch) { return ch == U'1' || ch == U'-' ? 3 : 4; }

static int temp_width(const ustr &s) {
  if (!tight_temp(s)) return measure(FONT_SMALL, s);
  int w = -1;
  for (char32_t ch : s) w += tight_adv(ch);
  return w;
}

static int draw_temp_text(Frame &f, const ustr &s, int x, int base, RGB color) {
  if (!tight_temp(s)) return f.text(FONT_SMALL, s, x, base, color);
  for (char32_t ch : s) {
    if (ch == U'-') f.fill(x, base - 3, 2, 1, color);
    else f.text(FONT_SMALL, ustr(1, ch), x, base, color);
    x += tight_adv(ch);
  }
  return x;
}

static void draw_day_temp(Frame &f, const ustr &s, int cx, int base, RGB color) {
  draw_temp_text(f, s, cx - (int)fdiv(temp_width(s), 2), base, color);
}

struct Part {
  ustr t;
  RGB c;
  bool n;
};

static int fd_left(const std::vector<Part> &parts) {
  int w = -1;
  for (const Part &p : parts) w += (p.n ? temp_width(p.t) : measure(FONT_SMALL, p.t)) + 1;
  return FD_HL_RIGHT - w + 1;
}

// Today on rows 0-7. Mirrors drawTopBar() in draw.js.
static void draw_top_bar(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  int icon = icon_index(wx["icon"]);
  if (icon >= 0) draw_icon(f, icon, FD_ICON_X, 0);
  ustr temp = vstr(wx["temp"]);
  if (shadow) {
    RGB sh = scale_color(temp_color(wx["temp"].num(), wx["c"]), 0.2);
    f.text(FONT_SMALL, U"°", f.text(FONT_5X7, temp, FD_TEMP_X + 1, 8, sh), 7, sh);
  }
  int x = f.text(FONT_5X7, temp, FD_TEMP_X, 7, C::label);
  f.text(FONT_SMALL, U"°", x, 6, C::label);
  int temp_right = x + 1 + (shadow ? 1 : 0);
  if (warn) {
    WarnStyle ws = warn_style(*warn);
    if (ws.blinks && blink) return;
    ustr word = (*warn)["lvl"].eq("warning") ? U"WARN" : U"WATCH";
    int gx = FD_HL_RIGHT - (measure(FONT_SMALL, ws.glyph) + TAG_GAP + measure(FONT_SMALL, word)) + 1;
    int word_x = f.text(FONT_SMALL, ws.glyph, gx, 7, ws.color);
    f.text(FONT_SMALL, word, word_x + TAG_GAP - 1, 7, ws.color);
  } else if (!wx["hi"].is_null() && !wx["lo"].is_null()) {
    ustr hi = vstr(wx["hi"]), lo = vstr(wx["lo"]);
    ustr up = g(assets::G_UP), down = g(assets::G_DOWN);
    std::vector<std::vector<Part>> ways = {
        {{up, FD_LETTER, false}, {hi, FD_NUM, true}, {U" " + down, FD_LETTER, false}, {lo, FD_NUM, true}},
        {{up, FD_LETTER, false}, {hi, FD_NUM, true}, {down, FD_LETTER, false}, {lo, FD_NUM, true}},
        {{hi, FD_NUM, true}, {U" ", FD_NUM, false}, {lo, FD_NUM, true}}};
    const std::vector<Part> *parts = &ways.back();
    for (const auto &w : ways)
      if (fd_left(w) >= temp_right + 2) {
        parts = &w;
        break;
      }
    int hx = fd_left(*parts);
    for (const Part &p : *parts) hx = p.n ? draw_temp_text(f, p.t, hx, 7, p.c) : f.text(FONT_SMALL, p.t, hx, 7, p.c);
  }
}

static void draw_five_day(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  draw_top_bar(f, wx, shadow, warn, blink);
  for (int i = 1; i < 5; i++) f.fill(i * FD_PITCH - 1, 10, 1, 22, C::divider);
  const Value &days = wx["days"];
  for (size_t i = 0; i < days.size() && i < 5; i++) {
    const Value &d = days[i];
    int cx = (int)i * FD_PITCH + 6;
    ctext(f, FONT_SMALL, vstr(d["d"]), cx, 15, C::grey);
    int icon = icon_index(d["icon"]);
    if (icon >= 0) draw_icon(f, icon, cx - 4, 17);
    draw_day_temp(f, vstr(d["hi"]), cx, 31, temp_color(d["hi"].num(), wx["c"]));
  }
}

static void draw_hourly(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  draw_top_bar(f, wx, shadow, warn, blink);
  for (int i = 1; i < 4; i++) f.fill(i * 16 - 1, 10, 1, 22, C::divider);
  const Value &hours = wx["hours"];
  for (size_t i = 0; i < hours.size() && i < 4; i++) {
    const Value &h = hours[i];
    int cx = (int)i * 16 + 7;
    ctext(f, FONT_SMALL, vstr(h["h"]), cx, 15, C::grey);
    int icon = icon_index(h["icon"]);
    if (icon >= 0) draw_icon(f, icon, cx - 4, 17);
    draw_day_temp(f, vstr(h["t"]), cx, 31, temp_color(h["t"].num(), wx["c"]));
  }
}

// ---- rain bars ----

static const RGB RAIN_LEVELS[] = {hexc(0x0a2a78), hexc(0x0f48c0), hexc(0x1a6cff)};
static const RGB SNOW_LEVELS[] = {hexc(0x3357a6), hexc(0x6e83a6), hexc(0xa6a6a6)};
static const RGB RAIN_TEXT = hexc(0x60b0ff), SNOW_TEXT = hexc(0xa9c9ff), RAIN_DRY = hexc(0x081428),
                 AXIS = hexc(0x555555);
static const char *const FLAKE[] = {"..#..", "#.#.#", ".###.", "#.#.#", "..#.."};

static void draw_art(Frame &f, const char *const *art, int rows, int x, int y, RGB color) {
  for (int j = 0; j < rows; j++)
    for (int i = 0; art[j][i]; i++)
      if (art[j][i] == '#') f.fill(x + i, y + j, 1, 1, color);
}

static void draw_rain_bars(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  const Value &rain = wx["rain"];
  draw_top_bar(f, wx, shadow, warn, blink);
  bool snow = rain["snow"].truthy();
  RGB color = snow ? SNOW_TEXT : RAIN_TEXT;
  std::string title8 = json::str(rain["title"]);
  ustr title = U(title8);
  const char *const *art = nullptr;
  int art_rows = 0, art_w = 0;
  if (title8.find("RAIN") == std::string::npos && title8.find("SNOW") == std::string::npos) {
    art = snow ? FLAKE : WX_DROP;
    art_rows = snow ? 5 : 4;
    art_w = (int)strlen(art[0]);
  }
  int mark_w = art && measure(FONT_SMALL, title) + art_w + 2 <= 64 ? art_w + 2 : 0;
  int x = 32 - (int)fdiv(measure(FONT_SMALL, title) + mark_w, 2);
  if (mark_w) draw_art(f, art, art_rows, x, snow ? 9 : 10, snow ? color : WX_BLUE);
  f.text(FONT_SMALL, title, x + mark_w, 14, color);
  const RGB *levels = snow ? SNOW_LEVELS : RAIN_LEVELS;
  const Value &hs = rain["h"];
  for (size_t i = 0; i < hs.size() && i < 8; i++) {
    int h = (int)hs[i].num();
    if (!hs[i].truthy()) {
      f.fill((int)i * 8, 25, 7, 1, RAIN_DRY);
    } else {
      int l = clampi((int)rain["l"][i].num(), 1, 3);
      f.fill((int)i * 8, 26 - h, 7, h, levels[l - 1]);
    }
  }
  ctext(f, FONT_SMALL, U"1H", 31, 31, AXIS);
  rtext(f, FONT_SMALL, U"2H", 62, 31, AXIS);
}

// ---- radar ----

static int radar_value(const std::vector<uint8_t> &data, int i) {
  // 2048 bytes (one a pixel, as from the server), or 1024 packed (two a
  // byte, left pixel in the high nibble).
  if (data.size() == 2048) return data[i];
  uint8_t b = data[i >> 1];
  return i & 1 ? b & 15 : b >> 4;
}

static void draw_radar_frame(Frame &f, const std::vector<uint8_t> &data, double rb) {
  RadarColors rc = radar_colors(rb);
  for (int y = 0; y < 32; y++)
    for (int x = 0; x < 64; x++) {
      int v = radar_value(data, y * 64 + x);
      if (v >= 0 && v < 16 && rc.on[v]) f.fill(x, y, 1, 1, rc.c[v]);
    }
}

int radar_on_hand(const Value &ids, const Frames *frames) {
  int n = 0;
  if (frames && !frames->empty())
    for (size_t i = 0; i < ids.size(); i++)
      if (frames->count(json::str(ids[i]))) n++;
  return n;
}

// The radar loop: with every frame on hand, step through them in time order,
// then hold on the newest; while any is still downloading, hold on the
// newest on hand. Mirrors radarLoopIdx() in draw.js. -1 with none on hand.
int radar_loop_idx(const Value &ids, const Frames *frames, double t, const Timing &tm) {
  int n = radar_on_hand(ids, frames);
  if (!n) return -1;
  if ((size_t)n < ids.size()) {
    for (int i = (int)ids.size() - 1; i >= 0; i--)
      if (frames->count(json::str(ids[i]))) return i;
  }
  double cycle = std::max(1, n - 1) * tm.radarFrame + tm.radarHold;
  double pos = t - floor(t / cycle) * cycle;  // Python t % cycle
  return (int)std::min((double)(n - 1), floor(pos / tm.radarFrame));
}

// The rain turns: the radar loop plays `loops` full cycles, then the bars
// show for alt s. Mirrors rainBarsTurn() in draw.js.
bool rain_bars_turn(const Value &rn, int n, const Timing &tm, double t) {
  if (!rn.truthy() || !rn["h"].truthy() || !rn["alt"].truthy() || !rn["loops"].truthy() || !n) return false;
  double cycle = std::max(1, n - 1) * tm.radarFrame + tm.radarHold;
  double loop_ms = rn["loops"].num() * cycle;
  double period = loop_ms + rn["alt"].num() * 1000;
  double pos = t - floor(t / period) * period;
  return pos >= loop_ms;
}

static void render_weather(const Value &p, Frame &f, std::optional<double> now, std::optional<int> idx_o,
                           const Frames *frames, bool blink, std::optional<double> t_o) {
  const Value &r = p["radar"];
  const Value &ids = r["frames"];
  int nids = (int)ids.size();
  int idx;
  if (!ids.truthy()) idx = -1;
  else if (idx_o) idx = std::max(0, std::min(nids - 1, *idx_o));
  else idx = nids - 1;
  const Value &wx = r["wx"];
  const Value &rn = wx.truthy() ? wx["rain"] : Value::null_value();
  double clock = now ? *now : p["now"].num();
  double loop_t = t_o ? *t_o : clock * 1000;
  bool bars_turn = rain_bars_turn(rn, nids, timing(p), loop_t);
  const Value *warnp = p["warn"].truthy() ? &p["warn"] : nullptr;
  if (((!ids.truthy() || (frames && !radar_on_hand(ids, frames))) || bars_turn) && wx.truthy()) {
    bool shadow = r["tempShadow"].truthy();
    if (wx["rain"].truthy() && wx["rain"]["h"].truthy()) draw_rain_bars(f, wx, shadow, warnp, blink);
    else if (wx["hours"].truthy()) draw_hourly(f, wx, shadow, warnp, blink);
    else if (wx["days"].truthy()) draw_five_day(f, wx, shadow, warnp, blink);
    else draw_weather_screen(f, wx, warnp, blink, shadow);
    return;
  }
  const std::vector<uint8_t> *data = nullptr;
  if (idx >= 0 && frames && !frames->empty()) {
    auto it = frames->find(json::str(ids[idx]));
    if (it != frames->end()) data = &it->second;
  }
  if (data && !data->empty()) {
    const Value &rbv = r["rb"];
    double rb = r.has("rb") ? (rbv.is_null() ? 100 : rbv.num()) : 100;
    draw_radar_frame(f, *data, rb);
  }
  const Value &tb = r["timeBox"];
  if (r["split"].truthy() && tb.truthy()) f.fill((int)tb[0].num() - 1, 0, 1, 32, C::divider);
  int bx = 40, by = 0, bw = 24;
  if (tb.truthy()) {
    bx = (int)tb[0].num();
    by = (int)tb[1].num();
    bw = (int)tb[2].num();
  }
  int right = std::min(63, bx + bw - 1);
  int top = by + 2;
  // The clock: the frame's time (dim), or the current time (white) with
  // clock 'now' or before any frame.
  bool now_clock = r["clock"].eq("now");
  const Value &ft = r["ft"];
  double t;
  if (!now_clock && idx >= 0 && ft.truthy() && !ft[idx].is_null()) t = ft[idx].num();
  else t = now ? *now : p["now"].num();
  double tzo = p["tzo"].num(0);
  const RGB black{0, 0, 0};

  auto clear = [&](const Box &b) {
    if (b.has_y && b.y0 <= b.y1) f.fill(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 3, b.y1 - b.y0 + 3, black);
  };
  auto clear4 = [&](int x0, int y0, int x1, int y1) { clear(Box{x0, true, y0, x1, y1}); };

  const int seg_w = 2, seg_gap = 1;
  int ind_x = right - (nids * (seg_w + seg_gap) - seg_gap) + 1;
  if (ids.truthy()) clear4(ind_x, top, right, top + 1);

  auto draw_indicator = [&]() {
    int x = ind_x;
    for (int i = 0; i < nids; i++) {
      f.fill(x, top, seg_w, 2, i == idx ? C::amber : C::indicator);
      x += seg_w + seg_gap;
    }
  };

  std::optional<WarnStyle> ws;
  if (warnp) ws = warn_style(*warnp);
  bool hide_warn = ws && ws->blinks && blink;

  auto draw_warn_tag = [&]() {
    ustr word = (*warnp)["lvl"].eq("warning") ? U"WARN" : U"WATCH";
    int x0 = 64 - (measure(FONT_SMALL, ws->glyph) + TAG_GAP + measure(FONT_SMALL, word));
    f.fill(x0 - 1, 25, 64 - x0 + 1, 7, black);
    if (!hide_warn) {
      int x = f.text(FONT_SMALL, ws->glyph, x0, 31, ws->color);
      f.text(FONT_SMALL, word, x + TAG_GAP - 1, 31, ws->color);
    }
  };

  if (r["showTime"].is_false() && !r["temp"].is_null()) {
    ustr ts = vstr(r["temp"]) + U"°";
    int icon = icon_index(r["icon"]);
    int iw = icon >= 0 ? 10 : 0;
    int x0 = right + 1 - (iw + measure(FONT_SMALL, ts));
    if (icon >= 0) clear4(x0, top + 4, x0 + 7, top + 11);
    clear(text_box(FONT_SMALL, ts, x0 + iw, top + 10));
    draw_indicator();
    if (icon >= 0) draw_icon(f, icon, x0, top + 4);
    f.text(FONT_SMALL, ts, x0 + iw, top + 10, C::label);
    if (ws) draw_warn_tag();
    return;
  }
  if (r["clock"].eq("none")) {
    draw_indicator();
    if (ws) draw_warn_tag();
    return;
  }
  if (r["clock"].eq("age")) {
    double now_s = now ? *now : p["now"].num();
    double ft_i = idx >= 0 && ft.truthy() && !ft[idx].is_null() ? ft[idx].num() : now_s;
    ustr age = num_text(std::max(0LL, (long long)floor((now_s - ft_i + 30) / 60))) + U"m";
    clear(text_box(FONT_SMALL, age, right - measure(FONT_SMALL, age) + 1, top + 9));
    draw_indicator();
    rtext(f, FONT_SMALL, age, right, top + 9, C::radarSub);
    if (ws) draw_warn_tag();
    return;
  }
  if (r["cond"].truthy()) {
    // Time with conditions: time and A/P on one line, the temperature under it.
    ustr clk = clock_text(t, tzo);
    ustr ap = ampm_text(t, tzo).substr(0, 1);
    int ap_x = right - measure(FONT_SMALL, ap) + 1;
    int clock_right = ap_x - 2;
    bool has_ct = !r["temp"].is_null();
    ustr ct = has_ct ? vstr(r["temp"]) + U"°" : ustr();
    // The current time rolls (not a frame's time).
    std::optional<Roll> cr = now_clock ? take_roll("rad.clock", clk) : std::nullopt;
    clear(text_box(FONT_5X7, clk, clock_right - measure(FONT_5X7, clk) + 1, top + 11));
    if (cr) clear(text_box(FONT_5X7, cr->from, clock_right - measure(FONT_5X7, cr->from) + 1, top + 11));
    clear(text_box(FONT_SMALL, ap, ap_x, top + 11));
    if (has_ct) clear(text_box(FONT_SMALL, ct, right - measure(FONT_SMALL, ct) + 1, top + 18));
    draw_indicator();
    roll_text(f, FONT_5X7, clk, clock_right, top + 11, now_clock ? C::clock : C::radarTime, cr);
    f.text(FONT_SMALL, ap, ap_x, top + 11, C::radarSub);
    if (has_ct) rtext(f, FONT_SMALL, ct, right, top + 18, C::radarSub);
    if (ws) draw_warn_tag();
    return;
  }
  ustr clk = clock_text(t, tzo);
  ustr ap = ampm_text(t, tzo);
  int ap_x = right - measure(FONT_SMALL, ap) + 1;
  int w_x = ws ? ap_x - 2 - measure(FONT_SMALL, ws->glyph) : 0;
  std::optional<Roll> cr = now_clock ? take_roll("rad.clock", clk) : std::nullopt;
  clear(text_box(FONT_5X7, clk, right - measure(FONT_5X7, clk) + 1, top + 11));
  if (cr) clear(text_box(FONT_5X7, cr->from, right - measure(FONT_5X7, cr->from) + 1, top + 11));
  clear(text_box(FONT_SMALL, ap, ap_x, top + 18));
  if (ws) clear(text_box(FONT_SMALL, ws->glyph, w_x, top + 18));
  draw_indicator();
  // A frame's time is dimmed so it doesn't read as the current time.
  roll_text(f, FONT_5X7, clk, right, top + 11, now_clock ? C::clock : C::radarTime, cr);
  f.text(FONT_SMALL, ap, ap_x, top + 18, C::radarAmpm);
  if (ws && !hide_warn) f.text(FONT_SMALL, ws->glyph, w_x, top + 18, ws->color);
}

// ---- baseball (design spec §8) ----

static const RGB BB_LIVE = hexc(0xf0f0f0), BB_LOSE = hexc(0x6a6a6a), BB_BASE = hexc(0x454545),
                 BB_INFIELD = hexc(0x3a3a3a);
static const int BB_ROW_TOPS[] = {2, 12};  // away, home
static const int SCORE_RIGHT = 30, PANEL_X = 51, BB_BOTTOM = 31, BB_DIVIDER = 24, SCORE_ROLL = 8;
static const double SCORE_HOLD_S = 30, SCORE_FADE_S = 5;
static const RGB BLACK{0, 0, 0};

static ustr half_text(const Value &half) {
  if (half.eq("T")) return U"TOP";
  if (half.eq("B")) return U"BOT";
  if (half.eq("M")) return U"MID";
  if (half.eq("E")) return U"END";
  return U"";
}

static ustr bb_record(const Value &t) {
  if (t["w"].is_null() || t["l"].is_null()) return U"";
  return num_text((long long)t["w"].num()) + U"-" + num_text((long long)t["l"].num());
}

PickedGame pick_game(const Value &games, double now, double every, bool all_games) {
  // Live games take precedence (unless all_games); `every` seconds each by wall time.
  if (!games.truthy()) return PickedGame{-1, 0, 0};
  std::vector<int> pool;
  if (!all_games)
    for (size_t i = 0; i < games.size(); i++)
      if (games[i]["st"].eq("live")) pool.push_back((int)i);
  if (pool.empty())
    for (size_t i = 0; i < games.size(); i++) pool.push_back((int)i);
  long long pos = fmod_floor((long long)floor(now / every), (long long)pool.size());
  return PickedGame{pool[pos], (int)pos, (int)pool.size()};
}

static RGB score_color(const Value &side, double now, RGB rest = BB_LIVE) {
  if (side["at"].is_null()) return rest;
  double age = now - side["at"].num();
  if (age < 0 || age < SCORE_HOLD_S) return C::amber;
  if (age >= SCORE_HOLD_S + SCORE_FADE_S) return rest;
  return lerp_color(C::amber, rest, (age - SCORE_HOLD_S) / SCORE_FADE_S);
}

static const Roll *roll_of(const Rolls &rolls, const char *k) {
  auto it = rolls.find(k);
  return it == rolls.end() ? nullptr : &it->second;
}

static void draw_score(Frame &f, const ustr &text, int top, RGB color, const Roll *roll) {
  int base = top + 6;
  if (!roll || roll->from == text || roll->p >= 1) {
    rtext(f, FONT_5X7, text, SCORE_RIGHT, base, color);
    return;
  }
  int up = (int)jsround(ease_in_out(roll->p) * SCORE_ROLL);
  f.push_clip(SCORE_RIGHT - 12, top, SCORE_RIGHT, top + 6);
  const ustr &frm = roll->from;
  if (frm.size() == text.size()) {
    int x = SCORE_RIGHT - measure(FONT_5X7, text) + 1;
    for (size_t i = 0; i < text.size(); i++) {
      if (frm[i] == text[i]) {
        f.text(FONT_5X7, text.substr(i, 1), x, base, color);
      } else {
        f.text(FONT_5X7, frm.substr(i, 1), x, base - up, color);
        f.text(FONT_5X7, text.substr(i, 1), x, base - up + SCORE_ROLL, color);
      }
      x += measure(FONT_5X7, text.substr(i, 1)) + 1;
    }
  } else {
    rtext(f, FONT_5X7, frm, SCORE_RIGHT, base - up, color);
    rtext(f, FONT_5X7, text, SCORE_RIGHT, base - up + SCORE_ROLL, color);
  }
  f.pop_clip();
}

static void draw_diamond(Frame &f, int cx, int cy, int r, RGB color, bool filled) {
  for (int dy = -r; dy <= r; dy++)
    for (int dx = -r; dx <= r; dx++) {
      int d = abs(dx) + abs(dy);
      if (d == r || (filled && d < r)) f.fill(cx + dx, cy + dy, 1, 1, color);
    }
}

static void draw_infield(Frame &f, const Value &on, int cy = 7) {
  bool on0 = on.truthy() ? on[0].truthy() : false;
  bool on1 = on.truthy() ? on[1].truthy() : false;
  bool on2 = on.truthy() ? on[2].truthy() : false;
  draw_diamond(f, PANEL_X, cy, 5, BB_INFIELD, false);
  draw_diamond(f, PANEL_X, cy - 5, 2, on1 ? C::amber : BB_BASE, true);
  draw_diamond(f, PANEL_X - 5, cy, 2, on2 ? C::amber : BB_BASE, true);
  draw_diamond(f, PANEL_X + 5, cy, 2, on0 ? C::amber : BB_BASE, true);
}

static void draw_roll_text(Frame &f, const ustr &text, int left, int base, RGB color, const Roll *roll,
                           std::optional<int> from_left = std::nullopt) {
  if (!roll || roll->from == text || roll->p >= 1) {
    f.text(FONT_SMALL, text, left, base, color);
    return;
  }
  const ustr &frm = roll->from;
  int up = (int)jsround(ease_in_out(roll->p) * ROLL_DIST);
  int old_left = from_left ? *from_left : left + measure(FONT_SMALL, text) - measure(FONT_SMALL, frm);
  bool same = old_left == left && frm.size() == text.size();
  if (same)
    for (size_t i = 0; i < text.size(); i++)
      if (measure(FONT_SMALL, text.substr(i, 1)) != measure(FONT_SMALL, frm.substr(i, 1))) {
        same = false;
        break;
      }
  f.push_clip(0, base - 5, 63, base - 1);
  if (same) {
    int x = left;
    for (size_t i = 0; i < text.size(); i++) {
      if (frm[i] == text[i]) {
        f.text(FONT_SMALL, text.substr(i, 1), x, base, color);
      } else {
        f.text(FONT_SMALL, frm.substr(i, 1), x, base - up, color);
        f.text(FONT_SMALL, text.substr(i, 1), x, base - up + ROLL_DIST, color);
      }
      x += measure(FONT_SMALL, text.substr(i, 1)) + 1;
    }
  } else {
    f.text(FONT_SMALL, frm, old_left, base - up, color);
    f.text(FONT_SMALL, text, left, base - up + ROLL_DIST, color);
  }
  f.pop_clip();
}

struct LiveTexts {
  ustr inn, count, outs;
};

static LiveTexts live_texts(const Value &gm) {
  bool brk = gm["half"].eq("M") || gm["half"].eq("E");
  ustr h = half_text(gm["half"]);
  LiveTexts t;
  t.inn = (h.empty() ? ustr(U"TOP") : h) + U" " + vstr(gm["inn"]);
  if (!brk) {
    long long b = gm["b"].truthy() ? (long long)gm["b"].num() : 0;
    long long s = gm["s"].truthy() ? (long long)gm["s"].num() : 0;
    long long o = gm["o"].truthy() ? (long long)gm["o"].num() : 0;
    t.count = num_text(b) + U"-" + num_text(s);
    t.outs = num_text(o) + U" OUT";
  }
  return t;
}

static void bottom_layout(const ustr &count, const ustr &outs, int &count_left, int &outs_left) {
  outs_left = 63 - measure(FONT_SMALL, outs) + 1;
  count_left = outs_left - 5 - measure(FONT_SMALL, count);
}

// Count and outs, right-aligned; outgoing texts keep the old layout.
// Mirrors drawBottomLine() in draw.js.
static void draw_bottom_line(Frame &f, const LiveTexts &t, const Rolls &rolls) {
  auto was = [&](const char *k, const ustr &cur) {
    const Roll *r = roll_of(rolls, k);
    return r && r->p < 1 ? r->from : cur;
  };
  int count_left, outs_left, old_count_left, old_outs_left;
  bottom_layout(t.count, t.outs, count_left, outs_left);
  bottom_layout(was("count", t.count), was("outs", t.outs), old_count_left, old_outs_left);
  draw_roll_text(f, t.outs, outs_left, BB_BOTTOM, C::grey, roll_of(rolls, "outs"), old_outs_left);
  draw_roll_text(f, t.count, count_left, BB_BOTTOM, C::label, roll_of(rolls, "count"), old_count_left);
}

static void draw_no_games(Frame &f, double now, double tzo) {
  ustr clock = clock_text(now, tzo);
  ustr label = U"NO GAMES";
  int top = (32 - 18) / 2;
  f.text(FONT_CLOCK, clock, (int)fdiv(64 - measure(FONT_CLOCK, clock), 2), top + 10, C::clock);
  f.text(FONT_SMALL, label, (int)fdiv(64 - measure(FONT_SMALL, label), 2), top + 18, C::noTrains);
}

// ---- baseball, logo layout ----

static const int LG_W = 24, LG_ROWS = 12, LG_BAND_R = 37, LG_CX = 30, LG_INFIELD_Y = 8, LG_INN_BASE = 21,
                 LG_ROLL = 8;
static const int LG_TOPS[] = {0, 12};
static const double LG_DIM = 0.9, LG_LIGHT = 140;

static RGB band_base(const Value &side) {
  if (side["bd"].truthy()) return hexs(side["bd"].str_or(""));
  if (side["c"].truthy()) return hexs(side["c"].str_or(""));
  return C::grey;
}

// White text, or black (unlit) on a light band.
static RGB lg_ink(const Value &side, double dim) {
  RGB c = scale_color(band_base(side), dim);
  return (299.0 * c.r + 587.0 * c.g + 114.0 * c.b) / 1000 > LG_LIGHT ? BLACK : BB_LIVE;
}

static const std::vector<uint8_t> *logo_data(const Logos *logos, const Value &side) {
  if (!side["lg"].truthy() || !logos || logos->empty()) return nullptr;
  auto it = logos->find(json::str(side["lg"]));
  return it == logos->end() ? nullptr : &it->second;
}

static void draw_logo_band(Frame &f, const Value &side, int top, const Logos *logos, bool bands, double dim) {
  f.fill(0, top, LG_BAND_R + 1, LG_ROWS, scale_color(band_base(side), dim));
  ustr ab = side["ab"].truthy() ? vstr(side["ab"]) : ustr();
  if (bands) {
    f.text(FONT_5X7, ab, (LG_W >> 1) - (int)fdiv(measure(FONT_5X7, ab), 2), top + 9, lg_ink(side, dim));
    return;
  }
  const std::vector<uint8_t> *data = logo_data(logos, side);
  if (data && !data->empty() && data->size() >= (size_t)(LG_W * LG_ROWS * 3)) {
    for (int y = 0; y < LG_ROWS; y++)
      for (int x = 0; x < LG_W; x++) {
        int i = (y * LG_W + x) * 3;
        f.set(x, top + y, RGB{(uint8_t)jsround((*data)[i] * dim), (uint8_t)jsround((*data)[i + 1] * dim),
                              (uint8_t)jsround((*data)[i + 2] * dim)});
      }
  } else {
    ctext(f, FONT_5X7, ab, LG_W >> 1, top + 9, lg_ink(side, dim));
  }
}

static int lg_left(const ustr &t) { return LG_CX - (int)fdiv(measure(FONT_5X7, t), 2); }

static void draw_logo_score(Frame &f, const ustr &text, int top, RGB color, const Roll *roll, int dx = 0) {
  int base = top + 9;
  if (!roll || roll->from == text || roll->p >= 1) {
    f.text(FONT_5X7, text, lg_left(text) + dx, base, color);
    return;
  }
  int up = (int)jsround(ease_in_out(roll->p) * LG_ROLL);
  f.push_clip(LG_W, base - 6, LG_BAND_R + 1, base);
  const ustr &frm = roll->from;
  if (frm.size() == text.size()) {
    int x = lg_left(text);
    for (size_t i = 0; i < text.size(); i++) {
      if (frm[i] == text[i]) {
        f.text(FONT_5X7, text.substr(i, 1), x, base, color);
      } else {
        f.text(FONT_5X7, frm.substr(i, 1), x, base - up, color);
        f.text(FONT_5X7, text.substr(i, 1), x, base - up + LG_ROLL, color);
      }
      x += measure(FONT_5X7, text.substr(i, 1)) + 1;
    }
  } else {
    f.text(FONT_5X7, frm, lg_left(frm), base - up, color);
    f.text(FONT_5X7, text, lg_left(text), base - up + LG_ROLL, color);
  }
  f.pop_clip();
}

static std::string winner_of(const Value &gm) {
  if (!gm["st"].eq("final")) return "";
  double a = gm["away"]["r"].num(), h = gm["home"]["r"].num();
  if (a > h) return "away";
  if (h > a) return "home";
  return "";
}

static void render_baseball_logos(Frame &f, const Value &p, const Value &gm, double now, double tzo, const Rolls &rolls,
                                  const Logos *logos) {
  // Logos: the band layout until every logo the game uses has loaded.
  const Value &mlb = p["mlb"];
  bool bands = mlb["layout"].eq("bands");
  if (!bands) {
    for (const char *k : {"away", "home"}) {
      const Value &s = gm[k];
      if (s["lg"].truthy()) {
        const std::vector<uint8_t> *d = logo_data(logos, s);
        if (!(d && !d->empty() && d->size() >= (size_t)(LG_W * LG_ROWS * 3))) bands = true;
      }
    }
  }
  double dim = mlb["dim"].is_null() ? LG_DIM : mlb["dim"].num();
  bool final = gm["st"].eq("final");
  std::string winner = winner_of(gm);
  const char *keys[] = {"away", "home"};
  for (int s = 0; s < 2; s++) draw_logo_band(f, gm[keys[s]], LG_TOPS[s], logos, bands, dim);
  f.fill(0, BB_DIVIDER, 64, 1, C::divider);

  if (gm["st"].eq("pre")) {
    for (int s = 0; s < 2; s++) {
      const Value &side = gm[keys[s]];
      if (!bands) draw_logo_score(f, side["ab"].truthy() ? vstr(side["ab"]) : ustr(), LG_TOPS[s], lg_ink(side, dim), nullptr, -1);
      ctext(f, FONT_SMALL, bb_record(side), PANEL_X, LG_TOPS[s] + 8, C::grey);
    }
    f.text(FONT_SMALL, U"TODAY", 0, BB_BOTTOM, C::grey);
    ustr ap = ampm_text(gm["start"].num(), tzo);
    rtext(f, FONT_SMALL, ap, 63, BB_BOTTOM, C::grey);
    rtext(f, FONT_SMALL, clock_text(gm["start"].num(), tzo), 63 - measure(FONT_SMALL, ap) - 3, BB_BOTTOM, C::label);
    return;
  }
  if (final) {
    for (int s = 0; s < 2; s++) {
      const Value &side = gm[keys[s]];
      draw_logo_score(f, vstr(side["r"]), LG_TOPS[s], winner == keys[s] ? C::amber : lg_ink(side, dim), roll_of(rolls, keys[s]));
      ctext(f, FONT_SMALL, bb_record(side), PANEL_X, LG_TOPS[s] + 8, C::grey);
    }
    rtext(f, FONT_SMALL, U"FINAL", 63, BB_BOTTOM, C::label);
    return;
  }
  draw_logo_score(f, vstr(gm["away"]["r"]), LG_TOPS[0], score_color(gm["away"], now, lg_ink(gm["away"], dim)), roll_of(rolls, "away"));
  draw_logo_score(f, vstr(gm["home"]["r"]), LG_TOPS[1], score_color(gm["home"], now, lg_ink(gm["home"], dim)), roll_of(rolls, "home"));
  draw_infield(f, gm["on"], LG_INFIELD_Y);
  LiveTexts t = live_texts(gm);
  draw_roll_text(f, t.inn, PANEL_X - (int)fdiv(measure(FONT_SMALL, t.inn), 2), LG_INN_BASE, C::label, roll_of(rolls, "inn"));
  draw_bottom_line(f, t, rolls);
}

static void render_baseball(const Value &p, Frame &f, std::optional<double> now_o, std::optional<int> game,
                            const Rolls *rolls_in, const Logos *logos) {
  double now = now_o ? *now_o : p["now"].num();
  double tzo = p["tzo"].num(0);
  const Value &mlb = p["mlb"];
  const Value &games = mlb["games"];
  if (!games.truthy()) {
    draw_no_games(f, now, tzo);
    return;
  }
  int gi = game ? (int)fmod_floor(*game, (long long)games.size())
                : pick_game(games, now, timing(p).game, mlb["all"].is_true()).i;
  const Value &gm = games[gi];
  static const Rolls empty;
  const Rolls &rolls = rolls_in ? *rolls_in : empty;
  if (mlb["layout"].eq("logos") || mlb["layout"].eq("bands")) {
    render_baseball_logos(f, p, gm, now, tzo, rolls, logos);
    return;
  }
  bool final = gm["st"].eq("final");
  std::string winner = winner_of(gm);
  const char *keys[] = {"away", "home"};

  int name_end = 0;
  for (int s = 0; s < 2; s++) {
    const Value &side = gm[keys[s]];
    int top = BB_ROW_TOPS[s];
    f.fill(0, top, 3, 6, side["c"].truthy() ? hexs(side["c"].str_or("")) : C::grey);
    name_end = std::max(name_end, f.text(FONT_5X7, vstr(side["ab"]), 5, top + 6, winner == keys[s] ? C::amber : C::label));
  }
  f.fill(0, BB_DIVIDER, 64, 1, C::divider);

  if (gm["st"].eq("pre")) {
    f.text(FONT_SMALL, bb_record(gm["away"]), name_end + 2, BB_ROW_TOPS[0] + 6, C::grey);
    f.text(FONT_SMALL, bb_record(gm["home"]), name_end + 2, BB_ROW_TOPS[1] + 6, C::grey);
    f.text(FONT_SMALL, U"TODAY", 0, BB_BOTTOM, C::grey);
    ustr ap = ampm_text(gm["start"].num(), tzo);
    rtext(f, FONT_SMALL, ap, 63, BB_BOTTOM, C::grey);
    rtext(f, FONT_SMALL, clock_text(gm["start"].num(), tzo), 63 - measure(FONT_SMALL, ap) - 3, BB_BOTTOM, C::label);
    return;
  }
  if (final) {
    for (int s = 0; s < 2; s++) {
      RGB color = winner == keys[s] ? C::amber : !winner.empty() ? BB_LOSE : C::label;
      draw_score(f, vstr(gm[keys[s]]["r"]), BB_ROW_TOPS[s], color, roll_of(rolls, keys[s]));
      ctext(f, FONT_SMALL, bb_record(gm[keys[s]]), PANEL_X, BB_ROW_TOPS[s] + 6, C::grey);
    }
    rtext(f, FONT_SMALL, U"FINAL", 63, BB_BOTTOM, C::label);
    return;
  }
  draw_score(f, vstr(gm["away"]["r"]), BB_ROW_TOPS[0], score_color(gm["away"], now), roll_of(rolls, "away"));
  draw_score(f, vstr(gm["home"]["r"]), BB_ROW_TOPS[1], score_color(gm["home"], now), roll_of(rolls, "home"));
  draw_infield(f, gm["on"]);
  LiveTexts t = live_texts(gm);
  draw_roll_text(f, t.inn, PANEL_X - (int)fdiv(measure(FONT_SMALL, t.inn), 2), 20, C::label, roll_of(rolls, "inn"));
  draw_bottom_line(f, t, rolls);
}

std::optional<BaseballTexts> baseball_texts(const Value &p, double now) {
  // Texts that roll when they change, keyed by game and state.
  const Value &mlb = p["mlb"];
  const Value &games = mlb["games"];
  if (!games.truthy()) return std::nullopt;
  const Value &gm = games[pick_game(games, now, timing(p).game, mlb["all"].is_true()).i];
  BaseballTexts bt;
  bt.texts["away"] = vstr(gm["away"]["r"]);
  bt.texts["home"] = vstr(gm["home"]["r"]);
  if (gm["st"].eq("live")) {
    LiveTexts t = live_texts(gm);
    bt.texts["inn"] = t.inn;
    bt.texts["count"] = t.count;
    bt.texts["outs"] = t.outs;
  }
  bt.key = json::str(gm["id"]) + ":" + json::str(gm["st"]);
  return bt;
}

// ---- whole screen ----

static void apply_brightness(Frame &f, const Value &bright) {
  double b = bright.is_null() ? 100 : bright.num();
  double k = std::max(0.0, std::min(100.0, b)) / 100;
  if (k == 1) return;
  for (int i = 0; i < Frame::W * Frame::H * 3; i++) f.px[i] = (uint8_t)jsround(f.px[i] * k);
}

Frame &render(const Value &p, Frame &f, const RenderOpts &o) {
  std::string screen = o.screen ? o.screen : json::str(p["screen"]);
  if (!o.screen && !p["screen"].truthy()) screen = "";
  g_roller = o.roller;
  g_nums = o.nums;
  if (screen == "ticker") render_ticker(p, f, o.now, o.page, o.slide);
  else if (screen == "weather") render_weather(p, f, o.now, o.idx, o.frames, o.blink, o.t);
  else if (screen == "baseball") render_baseball(p, f, o.now, o.game, o.rolls, o.logos);
  else render_transit(p, f, o.now, o.blink, o.view);
  g_roller = nullptr;
  g_nums = nullptr;
  if (o.roller) o.roller->end();  // the Player calls begin(); render() ends the frame
  if (o.apply_bright) apply_brightness(f, p["bright"]);
  return f;
}

// ---- status screens (firmware/boardlib/status.py) ----

static void center(Frame &f, Font font, const ustr &s, int base, RGB color) {
  f.text(font, s, (int)fdiv(64 - measure(font, s), 2), base, color);
}

static std::string upper(std::string s) {
  for (char &c : s)
    if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
  return s;
}

static ustr first(const ustr &s, size_t n) { return s.substr(0, std::min(n, s.size())); }

void render_status(Frame &f, const std::string &kind, const std::string &detail) {
  ustr d = U(upper(detail));
  if (kind == "connecting") {
    center(f, FONT_5X7, U"WIFI", 13, C::grey);
    center(f, FONT_SMALL, first(d, 15), 22, C::grey);
  } else if (kind == "ok") {
    center(f, FONT_5X7, U"WIFI OK", 13, C::label);
    center(f, FONT_SMALL, first(d, 15), 22, C::grey);
  } else if (kind == "portal") {
    center(f, FONT_5X7, U"PORTAL", 10, C::amber);
    // MAC as two lines of 3 octets, for IT to whitelist.
    center(f, FONT_SMALL, first(d, 8), 20, C::label);
    center(f, FONT_SMALL, d.size() > 9 ? d.substr(9, 8) : ustr(), 27, C::label);
  } else if (kind == "nowifi") {
    center(f, FONT_5X7, U"NO WIFI", 13, C::red);
    center(f, FONT_SMALL, U"RETRYING", 22, C::grey);
  } else if (kind == "noserver") {
    center(f, FONT_5X7, U"NO SERVER", 13, C::red);
    center(f, FONT_SMALL, first(detail.empty() ? U"RETRYING" : d, 15), 22, C::grey);
  }
}

}  // namespace draw
