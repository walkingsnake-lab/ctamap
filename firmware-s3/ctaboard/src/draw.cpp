// The renderer; see draw.h. Pixel parity is with draw.js; most sections
// and function names still follow the frozen draw.py it was ported from.

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
  } else if (cp >= assets::PUNCT0 && cp < assets::PUNCT0 + assets::PUNCT_N) {
    t = assets::FONT_PUNCT[font];
    i = (cp - assets::PUNCT0) << 1;
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
  // A blank 64-wide frame: every screen starts at 64 (render() widens it).
  for (int i = 0; i < MAX_W * H * 3; i++) px[i] = 0;
  w = 64;
  floor = true;
  clip_.on = false;
  clips_.clear();
}

void Frame::set(int x, int y, RGB c) {
  if (x < 0 || y < 0 || x >= w || y >= H) return;
  if (clip_.on && (x < clip_.x0 || y < clip_.y0 || x > clip_.x1 || y > clip_.y1)) return;
  int i = (y * w + x) * 3;
  px[i] = c.r;
  px[i + 1] = c.g;
  px[i + 2] = c.b;
}

RGB Frame::get(int x, int y) const {
  int i = (y * w + x) * 3;
  return RGB{px[i], px[i + 1], px[i + 2]};
}

void Frame::fill(int x, int y, int fw, int fh, RGB c) {
  for (int j = y; j < y + fh; j++)
    for (int i = x; i < x + fw; i++) set(i, j, c);
}

static void *malloc_big(size_t n) { return std::malloc(n); }
void *(*big_alloc)(size_t) = malloc_big;

uint8_t *big_bytes(size_t n) {
  void *m = big_alloc(n);
  if (!m) m = std::malloc(n);
  if (!m) std::abort();  // as new would
  memset(m, 0, n);
  return static_cast<uint8_t *>(m);
}

Frame *big_frame() { return new (big_bytes(sizeof(Frame))) Frame(); }

void big_free(void *m) { std::free(m); }

void widen_px(uint8_t *px, int from_w, int to_w) {
  // In place, last row first: row y moves from y * from_w to y * to_w, which
  // is never before where it was, so no row is overwritten before it moves.
  if (from_w <= 0 || to_w <= from_w) return;
  for (int y = Frame::H - 1; y >= 0; y--)
    for (int x = to_w - 1; x >= 0; x--) {
      int i = (y * to_w + x) * 3, j = (y * from_w + x % from_w) * 3;
      uint8_t r = px[j], g = px[j + 1], b = px[j + 2];
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
}

void widen(Frame &f, int cols) {
  if (cols > Frame::MAX_W) cols = Frame::MAX_W;
  if (f.w >= cols) return;
  widen_px(f.px, f.w, cols);
  f.w = cols;
}

int cols_of(const Value &p) { return p["cols"].is_num() && p["cols"].num() == WIDE ? WIDE : 64; }

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

// The board's icon clock (RenderOpts::icon_t): drives the overnight owl.
static std::optional<double> g_icon_t;

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
static bool g_still = false;  // payload croll false: clocks don't roll (draw.js takeRoll)

static bool is_clock(const std::string &name) {
  return name.size() >= 5 && name.compare(name.size() - 5, 5, "clock") == 0;
}

static std::optional<Roll> take_roll(const std::string &name, const ustr &text) {
  bool still = g_still && is_clock(name);
  if (g_roller) {
    std::optional<Roll> r = g_roller->take(name, text);  // still seen, so clock() holds
    if (still) return std::nullopt;
    return r;
  }
  if (still) return std::nullopt;
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
static RollFont roll_font(Font font) {
  return font == FONT_5X7 ? RollFont{7, -6, -1} : font == FONT_CLOCK ? RollFont{11, -10, -1} : font == FONT_VCR ? RollFont{12, -11, -1}
       : font == FONT_D17 ? RollFont{18, -17, -1} : font == FONT_D13 ? RollFont{14, -13, -1} : font == FONT_D23 ? RollFont{24, -23, -1}
       : RollFont{6, -5, -1};
}

static bool same_shape(Font font, const ustr &a, const ustr &b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); i++)
    if (measure(font, a.substr(i, 1)) != measure(font, b.substr(i, 1))) return false;
  return true;
}

// Where a rolling text goes: its left edge at `pos`, its right edge at
// `pos`, or centered on the panel (draw.js xOf: () => x, rightAt, centerX).
enum Align { LEFT, RIGHT, CENTER, SPAN };
static int align_x(Font font, const ustr &s, Align a, int pos, int end = 64) {
  // CENTER: centered in columns pos to end - 1 (pos 0: the whole panel).
  // SPAN: centered in columns 0-pos.
  if (a == SPAN) return (int)fdiv(pos + 1 - measure(font, s), 2);
  return a == LEFT ? pos : a == RIGHT ? pos - measure(font, s) + 1 : pos + (int)fdiv(end - pos - measure(font, s), 2);
}

// Text that rolls when it changes. Pixel-identical to rollTextWith() in
// draw.js. Returns x after the last advance.
static int roll_text_at(Frame &f, Font font, const ustr &text, Align a, int pos, int base, RGB color,
                        const std::optional<Roll> &roll, int end = 64) {
  int x = align_x(font, text, a, pos, end);
  if (!roll) return f.text(font, text, x, base, color);
  const ustr &frm = roll->from;
  RollFont rf = roll_font(font);
  int up = (int)jsround(ease_in_out(roll->p) * rf.dist);
  int fx = align_x(font, frm, a, pos, end);
  f.push_clip(0, base + rf.t0, f.w - 1, base + rf.t1);
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

// Right-aligned at `right` (the header and radar clocks).
static int roll_text(Frame &f, Font font, const ustr &text, int right, int base, RGB color,
                     const std::optional<Roll> &roll) {
  return roll_text_at(f, font, text, RIGHT, right, base, color, roll);
}
// Named rolls: the big clocks and current-conditions numbers (draw.js rollText).
static int roll_named(Frame &f, Font font, const std::string &name, const ustr &text, Align a, int pos, int base, RGB color, int end = 64) {
  return roll_text_at(f, font, text, a, pos, base, color, take_roll(name, text), end);
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
  for (const auto &kv : prev_)
    if (is_clock(kv.first)) return true;
  return false;
}

// Station name + clock on rows 1-5, flush to the screen edges, both in
// `color`. `divider`: a line on row 7 (transit).
static void draw_header(Frame &f, const ustr &name, double now, double tzo, bool divider = false, bool clock = true,
                        RGB color = C::head) {
  f.text(FONT_SMALL, name, 0, 6, color);
  if (clock) {
    ustr ck = clock_text(now, tzo);
    roll_text(f, FONT_SMALL, ck, f.w - 1, 6, color, take_roll("hdr.clock", ck));
  }
  if (divider) f.fill(0, 7, f.w, 1, C::divider);
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
// Wide board: the warning spelled out (draw.js drawWarnWide).
static void draw_warn_wide(Frame &f, const Value &wx, const Value &warn, int base, double tzo) {
  WarnStyle ws = warn_style(warn);
  int gx = measure(FONT_SMALL, vstr(wx["temp"]) + U"°") + 4;
  int nx = gx + measure(FONT_SMALL, ws.glyph) + TAG_GAP;
  ustr lvl = warn["lvl"].eq("warning") ? U"WARNING" : U"WATCH";
  std::vector<ustr> names;
  if (warn["kind"].eq("tor")) names = {U"TORNADO " + lvl};
  else names = {U"SEVERE T-STORM " + lvl, U"T-STORM " + lvl};
  std::vector<ustr> until;
  if (!warn["until"].is_null()) {
    double t = warn["until"].num();
    ustr tt = clock_text(t, tzo) + U" " + ampm_text(t, tzo);
    until = {U"UNTIL " + tt, tt};
  }
  until.push_back(ustr());
  const ustr *name = nullptr, *u = nullptr;
  for (const ustr &x : until) {
    for (const ustr &n : names) {
      int end = nx + measure(FONT_SMALL, n) - 1 + (x.empty() ? 0 : 4 + measure(FONT_SMALL, x));
      if (end <= WIDE - 1) {
        name = &n;
        u = &x;
        break;
      }
    }
    if (name) break;
  }
  if (!name) {
    name = &names.back();
    u = nullptr;
  }
  f.text(FONT_SMALL, ws.glyph, gx, base, ws.color);
  f.text(FONT_SMALL, *name, nx, base, ws.color);
  if (u && !u->empty()) rtext(f, FONT_SMALL, *u, WIDE - 1, base, scale_color(ws.color, 0.6));
}

static void draw_weather(Frame &f, const Value &wx, const Value *warn, bool blink, double tzo = 0) {
  int base = 32;
  roll_named(f, FONT_SMALL, "wx.temp", vstr(wx["temp"]) + U"°", LEFT, 0, base, C::dimHead);
  if (warn && f.w == WIDE) {
    if (!(warn_style(*warn).blinks && blink)) draw_warn_wide(f, wx, *warn, base, tzo);
  } else if (warn) {
    WarnStyle ws = warn_style(*warn);
    if (ws.blinks && blink) return;
    ustr word = (*warn)["lvl"].eq("warning") ? U"WARNING" : U"WATCH";
    int x = f.w - 1 - (measure(FONT_SMALL, ws.glyph) + TAG_GAP + measure(FONT_SMALL, word)) + 1;
    f.text(FONT_SMALL, word, f.text(FONT_SMALL, ws.glyph, x, base, ws.color) + TAG_GAP - 1, base, ws.color);
  } else if (wx["word"].truthy()) {
    rtext(f, FONT_SMALL, vstr(wx["word"]), f.w - 1, base, C::dimHead);
  }
}

// Key layout: the key on rows 1-5, the station and clock on rows 27-31 under
// a divider on row 25. Mirrors drawKey() / drawBand() in draw.js.
// The key row (draw.js drawKey): `min`, or 128 wide `minutes`.
static void draw_key(Frame &f) {
  f.text(FONT_SMALL, U"trains to", 0, 6, C::dimHead);
  rtext(f, FONT_SMALL, f.w == WIDE ? U"minutes" : U"min", f.w - 1, 6, C::dimHead);
}

static void draw_band(Frame &f, const ustr &name, double now, double tzo, bool clock = true, RGB color = C::head,
                      bool divider = true) {
  if (divider) f.fill(0, 25, f.w, 1, C::divider);
  f.text(FONT_SMALL, name, 0, 32, color);
  if (clock) {
    ustr ck = clock_text(now, tzo);
    roll_text(f, FONT_SMALL, ck, f.w - 1, 32, color, take_roll("hdr.clock", ck));
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
// Same-length numbers roll only the digits that changed. x0..x1: the row's
// columns, for the roll's clip (x1 -1: the frame's last column).
static void draw_time_cell(Frame &f, const ustr &text, int right, int top, RGB color, const std::optional<Roll> &roll,
                           int x0 = 0, int x1 = -1) {
  int base = top + 5;
  if (!roll || roll->from == text || roll->p >= 1) {
    rtext(f, FONT_SMALL, text, right, base, color);
    return;
  }
  int up = (int)jsround(ease_in_out(roll->p) * ROLL_DIST);
  f.push_clip(x0, top, x1 < 0 ? f.w - 1 : x1, top + 4);
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

// A line with a major alert: its label (the payload's `al`, shortened to make
// room when needed) and the red alert circle ALERT_ICON_GAP px after it.
// Mirrors alertText / alertIconX / labelEnd in draw.js.
static const int ALERT_ICON_GAP = 2;
static int alert_icon_x(const ustr &text, int x) {
  return text.empty() ? x : x + measure(FONT_SMALL, text) + ALERT_ICON_GAP;
}

// steps: the third time a step dimmer than the second (payload ts).
// x0, right: the row's columns (a wide board's halves).
static std::vector<ViewCell> layout_cells(const LiveRow &r, double now, bool steps = false, int x0 = 0, int right = 63) {
  std::vector<ustr> texts;
  for (size_t k = 0; k < r.tn.size(); k++) texts.push_back(time_text(r.tn[k], now, k == 0));
  auto width_at = [&](int gap) {
    int w = 0;
    for (size_t i = 0; i < texts.size(); i++) w += measure(FONT_SMALL, texts[i]) + (i ? gap : 0);
    return w;
  };
  const Value &src = *r.src;
  ustr lbl = vstr(src["lbl"]);
  int label_end = src["a"].truthy()
                      ? alert_icon_x(src["al"].is_null() ? lbl : vstr(src["al"]), x0 + 5) + 4
                      : x0 + 5 + measure(FONT_SMALL, lbl) - 1;
  int gap = right - width_at(TIME_GAP) + 1 - label_end - 1 >= LABEL_GAP ? TIME_GAP : TIGHT_GAP;
  std::vector<ViewCell> cells(texts.size());
  int x = right;
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
  v.w = cols_of(p);
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
static View build_halves_view(const Value &p, double now);

View build_transit_view(const Value &p, double now) {
  if (p["view"].eq("chrono")) return build_chrono_view(p, now);
  if (cols_of(p) == WIDE && (p["view"].eq("split") || p["view"].eq("cols2") || p["view"].eq("byline"))) return build_halves_view(p, now);
  std::vector<LiveRow> rows = live_rows(p, now);
  // The wide key layout: the key's row holds the station and clock.
  bool wide_key = cols_of(p) == WIDE && p["key"].truthy();
  std::vector<int> tops = wide_key ? row_tops((int)rows.size(), true, p["wx"].truthy(), false, false)
                                   : row_tops((int)rows.size(), p["header"].truthy(), p["wx"].truthy(), p["headerDivider"].is_true(), p["key"].truthy());
  View v = view_base(p, now);
  v.mode = "dest";
  for (size_t i = 0; i < rows.size(); i++) {
    const Value &r = *rows[i].src;
    ViewRow vr;
    vr.ln = r["ln"].str_or("");
    vr.lbl = vstr(r["lbl"]);
    vr.key = vr.ln + ":" + utf8(vr.lbl);
    vr.a = r["a"].truthy();
    if (!r["al"].is_null()) vr.al = vstr(r["al"]);
    if (!r["aw"].is_null()) vr.aw = vstr(r["aw"]);
    vr.top = tops[i];
    vr.alpha = 1;
    vr.cells = layout_cells(rows[i], now, p["ts"].is_true(), 0, v.w - 1);
    v.rows.push_back(vr);
  }
  return v;
}

// A wide board's halves (draw.js buildHalvesView, HALVES, SPLIT_TOPS):
// split (northbound | southbound, the payload's `halves` labels on top, the
// station line at the bottom) or cols2 (two columns under the header). Rows
// carry `h`; both halves share row tops, set by the fuller one.
static const int HALVES[2][2] = {{0, 61}, {66, 127}};
static std::vector<int> split_tops(int n) {
  if (n <= 0) return {};
  if (n == 1) return {14};
  if (n == 2) return {10, 18};
  return {8, 14, 20};
}

// byline rows: at most 5 lines; a row off them (a bad `y`) is left out
// (draw.js bylineY).
static const int BYLINE_ROWS = 5;
static int byline_y(const Value &r) {
  const Value &y = r["y"];
  if (!y.truthy()) return 0;
  if (!y.is_num()) return -1;
  double v = y.num();
  return v == std::floor(v) && v >= 0 && v < BYLINE_ROWS ? (int)v : -1;
}

static View build_halves_view(const Value &p, double now) {
  bool split = p["view"].eq("split");
  std::vector<LiveRow> rows = live_rows(p, now);
  if (p["view"].eq("byline")) {
    // One row per line (draw.js buildHalvesView): each row on its line's
    // row `y`, in a half, or without `h` across the whole width; drawn as cols2.
    int n = 0;
    for (const LiveRow &r : rows) n = std::max(n, byline_y(*r.src) + 1);
    std::vector<int> tops = row_tops(n, p["header"].truthy(), p["wx"].truthy(), p["headerDivider"].is_true(), false);
    View v = view_base(p, now);
    v.mode = "cols2";
    v.w = WIDE;
    v.key = false;
    for (const LiveRow &lr : rows) {
      const Value &r = *lr.src;
      int y = byline_y(r);
      if (y < 0) continue;
      bool full = r["h"].is_null();
      int h = r["h"].truthy() ? 1 : 0;
      ViewRow vr;
      vr.ln = r["ln"].str_or("");
      vr.lbl = vstr(r["lbl"]);
      vr.key = (full ? std::string("f") : std::to_string(h)) + ":" + vr.ln + ":" + utf8(vr.lbl);
      vr.h = full ? -1 : h;
      vr.x0 = full ? 0 : HALVES[h][0];
      vr.right = full ? WIDE - 1 : HALVES[h][1];
      vr.a = r["a"].truthy();
      if (!r["al"].is_null()) vr.al = vstr(r["al"]);
      if (!r["aw"].is_null()) vr.aw = vstr(r["aw"]);
      vr.top = y < (int)tops.size() ? tops[y] : 0;
      vr.alpha = 1;
      vr.cells = layout_cells(lr, now, p["ts"].is_true(), vr.x0, vr.right);
      v.rows.push_back(vr);
    }
    return v;
  }
  std::vector<LiveRow> per[2];
  for (const LiveRow &r : rows) per[(*r.src)["h"].truthy() ? 1 : 0].push_back(r);
  int n = (int)std::max(per[0].size(), per[1].size());
  std::vector<int> tops = split ? split_tops(std::min(n, 3)) : row_tops(n, p["header"].truthy(), p["wx"].truthy(), p["headerDivider"].is_true(), false);
  View v = view_base(p, now);
  v.mode = split ? "split" : "cols2";
  v.w = WIDE;
  if (split)
    for (size_t i = 0; i < p["halves"].size(); i++) v.halves.push_back(vstr(p["halves"][i]));
  v.hdiv = !split && p["headerDivider"].is_true();
  v.key = false;
  if (split) v.wx = nullptr;
  for (int h = 0; h < 2; h++)
    for (size_t i = 0; i < per[h].size(); i++) {
      const Value &r = *per[h][i].src;
      ViewRow vr;
      vr.ln = r["ln"].str_or("");
      vr.lbl = vstr(r["lbl"]);
      vr.key = std::to_string(h) + ":" + vr.ln + ":" + utf8(vr.lbl);
      vr.h = h;
      vr.x0 = HALVES[h][0];
      vr.right = HALVES[h][1];
      vr.a = r["a"].truthy();
      if (!r["al"].is_null()) vr.al = vstr(r["al"]);
      vr.top = i < tops.size() ? tops[i] : 0;
      vr.alpha = 1;
      vr.cells = layout_cells(per[h][i], now, p["ts"].is_true(), vr.x0, vr.right);
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
    if (!r["al"].is_null()) vr.al = vstr(r["al"]);
    vr.num = (int)i + 1;
    vr.top = tops[i];
    vr.alpha = 1;
    ViewCell c;
    c.t = rows[i].tn[0];
    c.text = chrono_text(rows[i].tn[0], now, due);
    c.right = v.w - 1;
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

// lnc: labels in the line's color instead of white. A line with a major
// alert: the alert label, then the ticker's red alert circle. Static.
static void draw_view_row(Frame &f, const ViewRow &row, bool lnc) {
  int top = (int)jsround(row.top);
  bool chrono = row.num.has_value();
  RGB lc = line_color(row.ln);
  RGB line = fade(lc, row.alpha);
  // A half of a wide board (row.x0, row.right), else the whole panel.
  int x0 = row.x0, x1 = row.right >= 0 ? row.right : f.w - 1;
  if (chrono) draw_time_cell(f, num_text(*row.num), 2, top, fade(lc, row.alpha), row.numRoll);
  f.fill(chrono ? CHRONO_BLOCK_X : x0, top, 3, 5, line);
  int lx = chrono ? CHRONO_LABEL_X : x0 + 5;
  const ustr &text = row.a && row.al ? *row.al : row.lbl;
  f.text(FONT_SMALL, text, lx, top + 5, fade(lnc ? lc : C::label, row.alpha));
  if (row.a) {
    int ix = alert_icon_x(text, lx);
    f.text(FONT_SMALL, g(assets::G_ALERT_DISC), ix, top + 5, fade(C::red, row.alpha));
    f.text(FONT_SMALL, g(assets::G_ALERT_MARK), ix, top + 5, fade(C::white, row.alpha));
    if (row.aw) f.text(FONT_SMALL, *row.aw, ix + 5 + 3, top + 5, fade(C::red, row.alpha));
  }
  for (const ViewCell &cell : row.cells) {
    double a = cell.alpha * row.alpha;
    if (a <= 0) continue;
    draw_time_cell(f, cell.text, (int)jsround(cell.right), top, fade(cell.color, a), cell.roll, x0, x1);
  }
}

// Overnight owl (draw.js owlRows): its frame at icon-clock ms t, or the
// static owl (frame 0) without a clock.
int owl_frame(std::optional<double> t) {
  if (!t) return 0;
  long long total = 0;
  for (int i = 0; i < assets::OWL_FRAMES_N; i++) total += assets::OWL_FRAMES[i].ms;
  long long k = fmod_floor((long long)floor(*t), total);
  for (int i = 0; i < assets::OWL_FRAMES_N; i++) {
    if (k < assets::OWL_FRAMES[i].ms) return i;
    k -= assets::OWL_FRAMES[i].ms;
  }
  return 0;
}

static RGB owl_color(char code) {
  for (int i = 0; i < assets::OWL_PALETTE_N; i++)
    if (assets::OWL_PALETTE[i].code == code)
      return RGB{assets::OWL_PALETTE[i].r, assets::OWL_PALETTE[i].g, assets::OWL_PALETTE[i].b};
  return RGB{};
}

// No trains (draw.js drawOvernight): the owl on a line at the left, the
// big clock and NO TRAINS centered in x 16-63.
static const int OWL_X = 2, OWL_PANEL = 16;
static void draw_overnight(Frame &f, const View &view, double now) {
  ustr clock = clock_text(now, view.tzo);
  ustr nt = view.stale ? U"NO DATA" : U"NO TRAINS";
  int bottom = view.wx ? 25 : 31;
  // A wide board: the same, 32 px in, the line across the whole width.
  int x0 = f.w == WIDE ? 32 : 0;
  f.fill(0, bottom, f.w, 1, C::perch);
  const char *px = assets::OWL_FRAMES[owl_frame(g_icon_t)].px;
  int oy = bottom - assets::OWL_H;
  for (int j = 0; j < assets::OWL_H; j++)
    for (int i = 0; i < assets::OWL_W; i++) {
      char c = px[j * assets::OWL_W + i];
      if (c != '.') f.fill(x0 + OWL_X + i, oy + j, 1, 1, owl_color(c));
    }
  int top = view.wx ? 3 : 5;
  roll_named(f, FONT_CLOCK, "big.clock", clock, CENTER, x0 + OWL_PANEL, top + 10, C::clock, x0 + 64);
  f.text(FONT_SMALL, nt, align_x(FONT_SMALL, nt, CENTER, x0 + OWL_PANEL, x0 + 64), top + 18, C::noTrains);
}

static void draw_stale(Frame &f, const Value &p) {
  if (p["stale"].truthy()) f.fill(0, 0, f.w, 1, C::red);
}

// Wide board, northbound | southbound (draw.js drawSplit): each half's label
// on rows 1-5, its rows, the station line at the bottom; NO TRAINS in a half
// with none.
static void draw_split(Frame &f, const View &view) {
  for (int h = 0; h < 2; h++) {
    int x0 = HALVES[h][0], x1 = HALVES[h][1];
    f.text(FONT_SMALL, h < (int)view.halves.size() ? view.halves[h] : ustr(), x0, 6, C::head);
    bool any = false;
    for (const ViewRow &r : view.rows)
      if ((r.h == 1 ? 1 : 0) == h) any = true;
    if (!any) {
      ustr nt = U"NO TRAINS";
      f.text(FONT_SMALL, nt, x0 + (int)fdiv(x1 - x0 + 1 - measure(FONT_SMALL, nt), 2), 19, C::noTrains);
    }
  }
  if (view.has_header) draw_band(f, view.header, view.now, view.tzo, view.clock, C::dimHead, false);
  f.push_clip(0, 7, f.w - 1, view.has_header ? 25 : 31);
  for (const ViewRow &row : view.rows) draw_view_row(f, row, view.lnc);
  f.pop_clip();
}

static void draw_transit_view(Frame &f, const View &view, bool blink) {
  if (view.rows.empty()) {
    draw_overnight(f, view, view.now);
  } else if (view.mode == "split") {
    draw_split(f, view);
  } else {
    bool wide_key = view.key && view.w == WIDE;
    if (wide_key) {
      draw_key(f);
    } else if (view.key) {
      draw_key(f);
      if (view.has_header) draw_band(f, view.header, view.now, view.tzo, view.clock);
    } else if (view.has_header) {
      draw_header(f, view.header, view.now, view.tzo, view.hdiv, view.clock, C::dimHead);
    }
    int clip_top = wide_key ? 7 : view.key ? 6 : (view.has_header ? 7 : 0);
    int clip_bottom = (!wide_key && view.key && view.has_header) ? 24 : (view.wx ? 25 : 31);
    f.push_clip(0, clip_top, f.w - 1, clip_bottom);
    for (const ViewRow &row : view.rows) draw_view_row(f, row, view.lnc);
    f.pop_clip();
  }
  if (view.wx) draw_weather(f, *view.wx, view.warn, blink, view.tzo);
}

// A wide payload's rows draw 128 across; with none (overnight) the 64
// layout shows on both panels (render() widens it).
static void render_transit(const Value &p, Frame &f, std::optional<double> now, bool blink, const View *view) {
  double n = now ? *now : p["now"].num();
  View built;
  if (!view) {
    built = build_transit_view(p, n);
    view = &built;
  }
  if (cols_of(p) == WIDE) f.w = WIDE;
  draw_transit_view(f, *view, blink);
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
    st->h = r.h;
    st->x0 = r.x0;
    st->right = r.right;
    st->a = r.a;
    st->al = r.al;
    st->aw = r.aw;
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
    vr.h = st.h;
    vr.x0 = st.x0;
    vr.right = st.right;
    vr.a = st.a;
    vr.al = st.al;
    vr.aw = st.aw;
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

// Wide board (draw.js drawTickerItemWide): the CTA platform sign's row:
// the row number (or the alert circle) in the index column, the band to the
// right edge, the full destination, the time right-aligned at
// TICKER_TIME_RIGHT, the status icon right-aligned to column 126 on the
// text's baseline: three waves (6 x 6) for a tracked train, the clock
// (5 x 5) for a schedule-based one.
static const int TICKER_TIME_RIGHT = 116;
struct TickerIcon { int x, y, n; const char *rows[6]; };
static const TickerIcon TICKER_LIVE = {121, 3, 6, {"###...", "...#..", "##..#.", "..#..#", "#..#.#", ".#.#.#"}};
static const TickerIcon TICKER_SCH = {122, 4, 5, {".###.", "#.#.#", "#.###", "#...#", ".###."}};
// A major alert: the circle TICKER_ALERT_GAP px after the name, as on the
// CTA's signs; the row number stays in the index column.
static const int TICKER_ALERT_GAP = 3;
static void draw_ticker_item_wide(Frame &f, const Value &it, int idx, int top, double now, bool due, double fill) {
  int base = top + 9;
  RGB white = C::white;
  f.fill(0, top, 5, 12, C::index);
  f.fill(5, top, f.w - 5, 12, scale_color(line_color(it["ln"].str_or("")), fill));
  f.text(FONT_SMALL, num_text(idx), 1, base, C::label);
  ustr d = vstr(it["d"]);
  f.text(FONT_5X7, d, 7, base, white);
  if (it["a"].truthy()) {
    int ax = 7 + measure(FONT_5X7, d) + TICKER_ALERT_GAP;
    f.text(FONT_SMALL, g(assets::G_ALERT_DISC), ax, base, C::red);
    f.text(FONT_SMALL, g(assets::G_ALERT_MARK), ax, base, C::white);
  }
  long long m = minutes_until(it["t"].num(), now);
  if (m <= 1 && due) {
    rtext(f, FONT_5X7, U"Due", TICKER_TIME_RIGHT, base, white);
  } else {
    int mw = measure(FONT_5X7, g(assets::G_MIN));
    f.text(FONT_5X7, g(assets::G_MIN), TICKER_TIME_RIGHT - mw + 1, base, white);
    rtext(f, FONT_5X7, num_text(m <= 1 ? 2 : m), TICKER_TIME_RIGHT - mw - 2, base, white);
  }
  const TickerIcon &icon = it["s"].truthy() ? TICKER_SCH : TICKER_LIVE;
  for (int j = 0; j < icon.n; j++)
    for (int i = 0; icon.rows[j][i]; i++)
      if (icon.rows[j][i] == '#') f.fill(icon.x + i, top + icon.y + j, 1, 1, white);
}

int ticker_pages(const Value &p, double now) {
  long long n = (long long)live_ticker(p, now).size();
  return (int)std::max(1LL, -fdiv(-n, 2));
}

static void render_ticker(const Value &p, Frame &f, std::optional<double> now_o, int page, double slide) {
  double now = now_o ? *now_o : p["now"].num();
  const bool wide = cols_of(p) == WIDE;
  if (wide) f.w = WIDE;
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
      (wide ? draw_ticker_item_wide : draw_ticker_item)(f, it, (int)n + 1, 7 + i * 13 + shift, now, first(key_of(it)) == n, fill);
    }
  };
  f.push_clip(0, 7, f.w - 1, 31);
  draw_page(page, -offset);
  if (offset > 0 && pages > 1) draw_page((page + 1) % pages, 26 - offset);
  f.pop_clip();
  draw_stale(f, p);
}

// ---- weather screen (design spec §7) ----

static const RGB WX_BLUE = hexc(0x1e90ff);
static const char *const WX_DROP[] = {".#.", "###", "###", ".#."};

// Temperature scale (F): the shadow and forecast highs use TEMP_STOPS; text
// (feels-like) the same scale with the cold end lifted.
struct TempStop { double t; uint32_t c; };
static const TempStop TEMP_STOPS[7] = {
    {-10, 0x3050ff}, {20, 0x40a0ff}, {40, 0x30d0d0}, {55, 0x40d040}, {70, 0xffd000}, {85, 0xff8000}, {100, 0xff2020}};
static const TempStop TEXT_TEMP_STOPS[7] = {
    {-10, 0x6080ff}, {20, 0x60b0ff}, {40, 0x30d0d0}, {55, 0x40d040}, {70, 0xffd000}, {85, 0xff8000}, {100, 0xff2020}};

static RGB temp_color(double t, const Value &c, const TempStop *stops = TEMP_STOPS) {
  // Stops are F; c: the temperature is C (wx 'c').
  if (c.truthy()) t = floor(t * 9 / 5) + 32;
  if (t <= stops[0].t) return hexc(stops[0].c);
  for (int i = 1; i < 7; i++) {
    if (t <= stops[i].t) return lerp_color(hexc(stops[i - 1].c), hexc(stops[i].c), (t - stops[i - 1].t) / (stops[i].t - stops[i - 1].t));
  }
  return hexc(stops[6].c);
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
    f.text(FONT_SMALL, U"°", roll_named(f, FONT_5X7, "wx.top", temp, LEFT, FD_TEMP_X + 1, 8, sh), 7, sh);
  }
  int x = roll_named(f, FONT_5X7, "wx.top", temp, LEFT, FD_TEMP_X, 7, C::label);
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

// ---- current conditions (draw.js drawConditions) ----
// The top bar, then a readout: label in grey from x0, value right-aligned to
// x63 in its color, dot leaders between on odd columns. SKY / FEELS / WIND,
// and RAIN while the payload's 'rl' is set: four lines on baselines 14, 20,
// 26, 32, otherwise three on 16, 23, 30.

static RGB sky_color(const Value &icon) {
  if (icon.eq("rain") || icon.eq("ice")) return hexc(0x4aa0ff);
  if (icon.eq("snow") || icon.eq("tsnow")) return hexc(0xc8e8ff);
  if (icon.eq("sun")) return hexc(0xffc800);
  if (icon.eq("moon")) return hexc(0xffe47a);
  return C::label;
}

static void draw_readout(Frame &f, const ustr &label, const char *name, const ustr &value, int base, RGB color) {
  int lx = f.text(FONT_SMALL, label, 0, base, C::head);
  int vx = 63 - measure(FONT_SMALL, value) + 1;
  for (int x = lx + 1 + ((lx + 1) % 2 ? 0 : 1); x < vx - 2; x += 2) f.fill(x, base - 1, 1, 1, C::divider);
  if (name) roll_named(f, FONT_SMALL, name, value, RIGHT, 63, base, color);
  else f.text(FONT_SMALL, value, vx, base, color);
}

static void draw_conditions(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  draw_top_bar(f, wx, shadow, warn, blink);
  struct Line { ustr label; const char *name; ustr value; RGB color; };
  Line lines[4];
  int n = 0;
  lines[n++] = {U"SKY", nullptr, wx["word"].truthy() ? vstr(wx["word"]) : ustr(), sky_color(wx["icon"])};
  if (!wx["feels"].is_null())
    lines[n++] = {U"FEELS", "wx.feels", vstr(wx["feels"]) + U"°", temp_color(wx["feels"].num(), wx["c"], TEXT_TEMP_STOPS)};
  if (wx["wind"].truthy()) {
    ustr w = vstr(wx["wind"]);
    lines[n++] = {U"WIND", nullptr, w == U"CALM" ? w : w + U" MPH", C::label};
  }
  if (wx["rl"].truthy() && !wx["pop"].is_null()) lines[n++] = {U"RAIN", "wx.pop", vstr(wx["pop"]) + U"%", WX_BLUE};
  static const int B4[] = {14, 20, 26, 32}, B3[] = {16, 23, 30};
  for (int i = 0; i < n; i++) draw_readout(f, lines[i].label, lines[i].name, lines[i].value, n == 4 ? B4[i] : B3[i], lines[i].color);
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

// ---- wide weather layouts (draw.js drawTopBarWide, drawWeek, drawDayHours,
// drawConditionsWide; contract "Width") ----
static const int WW_RIGHT = 126, WW_COLS7 = 18, WW_COLS8 = 16;
static const RGB WW_POP0 = hexc(0x3a3a3a), WW_POP_LOW = hexc(0x24538c);
static ustr wide_date_line(double now, double tzo);  // "TUE NOV 3" (after local_date below)

static void draw_top_bar_wide(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  int icon = icon_index(wx["icon"]);
  if (icon >= 0) draw_icon(f, icon, FD_ICON_X, 0);
  ustr temp = vstr(wx["temp"]);
  if (shadow) {
    RGB sh = scale_color(temp_color(wx["temp"].num(), wx["c"]), 0.2);
    f.text(FONT_SMALL, U"°", roll_named(f, FONT_5X7, "wx.top", temp, LEFT, FD_TEMP_X + 1, 8, sh), 7, sh);
  }
  int x = roll_named(f, FONT_5X7, "wx.top", temp, LEFT, FD_TEMP_X, 7, C::label);
  f.text(FONT_SMALL, U"°", x, 6, C::label);
  if (wx["word"].truthy()) f.text(FONT_SMALL, vstr(wx["word"]), x + 1 + 5, 7, C::wxText);
  if (warn) {
    WarnStyle ws = warn_style(*warn);
    if (ws.blinks && blink) return;
    ustr word = (*warn)["lvl"].eq("warning") ? U"WARNING" : U"WATCH";
    int gx = WW_RIGHT - (measure(FONT_SMALL, ws.glyph) + TAG_GAP + measure(FONT_SMALL, word)) + 1;
    f.text(FONT_SMALL, word, f.text(FONT_SMALL, ws.glyph, gx, 7, ws.color) + TAG_GAP - 1, 7, ws.color);
  } else if (!wx["hi"].is_null() && !wx["lo"].is_null()) {
    std::vector<Part> parts = {{g(assets::G_UP), FD_LETTER, false}, {vstr(wx["hi"]), FD_NUM, true},
                               {U" " + g(assets::G_DOWN), FD_LETTER, false}, {vstr(wx["lo"]), FD_NUM, true}};
    int hx = fd_left(parts) + (WW_RIGHT - FD_HL_RIGHT);
    for (const Part &p : parts) hx = p.n ? draw_temp_text(f, p.t, hx, 7, p.c) : f.text(FONT_SMALL, p.t, hx, 7, p.c);
  }
}

// A temperature and its degree sign (Tom Thumb), centered at cx.
static void draw_deg_temp(Frame &f, const Value &t, int cx, int base, RGB color) {
  ustr str = vstr(t);
  int w = temp_width(str) + 1 + measure(FONT_SMALL, U"°");
  f.text(FONT_SMALL, U"°", draw_temp_text(f, str, cx - (int)fdiv(w, 2), base, color), base, color);
}

static void draw_week(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  bool bar = !wx["notop"].truthy();
  if (bar) draw_top_bar_wide(f, wx, shadow, warn, blink);
  int y0 = bar ? 10 : 0, dB = bar ? 15 : 6, iY = bar ? 17 : 8, hB = bar ? 31 : 23;
  for (int i = 1; i < 7; i++) f.fill(i * WW_COLS7, y0, 1, 32 - y0, C::divider);
  const Value &week = wx["week"];
  for (size_t i = 0; i < week.size() && i < 7; i++) {
    const Value &d = week[i];
    int cx = (int)i * WW_COLS7 + 9;
    ctext(f, FONT_SMALL, vstr(d["d"]), cx, dB, i == 0 ? C::label : C::grey);
    int icon = icon_index(d["icon"]);
    if (icon >= 0) draw_icon(f, icon, cx - 4, iY);
    draw_deg_temp(f, d["hi"], cx, hB, temp_color(d["hi"].num(), wx["c"]));
    if (!bar && !d["lo"].is_null()) draw_deg_temp(f, d["lo"], cx, 30, scale_color(temp_color(d["lo"].num(), wx["c"]), 0.6));
  }
}

static void draw_day_hours(Frame &f, const Value &wx, bool shadow, const Value *warn, bool blink) {
  bool bar = !wx["notop"].truthy();
  if (bar) draw_top_bar_wide(f, wx, shadow, warn, blink);
  int y0 = bar ? 10 : 0, lB = bar ? 15 : 6, iY = bar ? 17 : 8, tB = bar ? 31 : 23;
  for (int i = 1; i < 8; i++) f.fill(i * WW_COLS8 - 1, y0, 1, 32 - y0, C::divider);
  const Value &hs = wx["hours24"];
  for (size_t i = 0; i < hs.size() && i < 8; i++) {
    const Value &h = hs[i];
    int cx = (int)i * WW_COLS8 + 7;
    ctext(f, FONT_SMALL, vstr(h["h"]), cx, lB, C::grey);
    int icon = icon_index(h["icon"]);
    if (icon >= 0) draw_icon(f, icon, cx - 4, iY);
    draw_deg_temp(f, h["t"], cx, tB, temp_color(h["t"].num(), wx["c"]));
    if (!bar && !h["p"].is_null()) {
      double pp = h["p"].num();
      draw_day_temp(f, vstr(h["p"]) + U"%", cx, 30, pp <= 0 ? WW_POP0 : pp < 20 ? WW_POP_LOW : WX_BLUE);
    }
  }
}

static void draw_icon2x(Frame &f, int icon, int x, int y) {
  const char *px = assets::ICONS[icon].px;
  for (int j = 0; j < 8; j++)
    for (int i = 0; i < 8; i++) {
      char c = px[j * 8 + i];
      if (c != '.') f.fill(x + i * 2, y + j * 2, 2, 2, icon_color(c));
    }
}

static const int CONW_X0 = 58, CONW_L5[] = {6, 12, 18, 24, 30}, CONW_L4[] = {7, 15, 23, 31};
static void draw_conditions_wide(Frame &f, const Value &p, double now, const Value &wx, bool shadow, const Value *warn, bool blink) {
  int icon = icon_index(wx["icon"]);
  if (icon >= 0) draw_icon2x(f, icon, 1, 0);
  ustr temp = vstr(wx["temp"]);
  if (shadow) {
    RGB sh = scale_color(temp_color(wx["temp"].num(), wx["c"]), 0.2);
    f.text(FONT_SMALL, U"°", roll_named(f, FONT_CLOCK, "wx.temp", temp, LEFT, 20, 14, sh) + 1, 7, sh);
  }
  int tx = roll_named(f, FONT_CLOCK, "wx.temp", temp, LEFT, 19, 13, C::label);
  f.text(FONT_SMALL, U"°", tx, 6, C::label);
  if (warn) {
    WarnStyle ws = warn_style(*warn);
    if (!(ws.blinks && blink)) {
      ustr word = (*warn)["lvl"].eq("warning") ? U"WARNING" : U"WATCH";
      f.text(FONT_SMALL, word, f.text(FONT_SMALL, ws.glyph, 0, 25, ws.color) + TAG_GAP - 1, 25, ws.color);
    }
  } else if (!wx["hi"].is_null() && !wx["lo"].is_null()) {
    int hx = f.text(FONT_SMALL, g(assets::G_UP), 0, 25, FD_LETTER) + 1;
    hx = draw_temp_text(f, vstr(wx["hi"]), hx, 25, FD_NUM) + 3;
    hx = f.text(FONT_SMALL, g(assets::G_DOWN), hx, 25, FD_LETTER) + 1;
    draw_temp_text(f, vstr(wx["lo"]), hx, 25, FD_NUM);
  }
  double tzo = p["tzo"].num(0);
  f.text(FONT_SMALL, wide_date_line(now, tzo), 0, 31, C::dimHead);
  struct Line { ustr label; const char *name; ustr value; RGB color; };
  Line lines[5];
  int n = 0;
  lines[n++] = {U"SKY", nullptr, wx["word"].truthy() ? vstr(wx["word"]) : ustr(), sky_color(wx["icon"])};
  if (!wx["feels"].is_null())
    lines[n++] = {U"FEELS", "wx.feels", vstr(wx["feels"]) + U"°", temp_color(wx["feels"].num(), wx["c"], TEXT_TEMP_STOPS)};
  if (wx["wind"].truthy()) {
    ustr w = vstr(wx["wind"]);
    lines[n++] = {U"WIND", nullptr, w == U"CALM" ? w : w + U" MPH", C::label};
  }
  if (wx["rl"].truthy() && !wx["pop"].is_null()) lines[n++] = {U"RAIN", "wx.pop", vstr(wx["pop"]) + U"%", WX_BLUE};
  const Value &sun = wx["sun"];
  if (sun.truthy()) {
    bool rise = sun["k"].eq("rise");
    double t = sun["t"].num();
    lines[n++] = {rise ? U"SUNRISE" : U"SUNSET", nullptr, clock_text(t, tzo) + U" " + ampm_text(t, tzo), rise ? hexc(0xffc23a) : hexc(0xff7414)};
  }
  for (int i = 0; i < n; i++) {
    int base = n == 5 ? CONW_L5[i] : CONW_L4[i];
    int lx = f.text(FONT_SMALL, lines[i].label, CONW_X0, base, C::head);
    int vx = WIDE - measure(FONT_SMALL, lines[i].value);
    for (int x = lx + 1 + ((lx + 1) % 2 ? 0 : 1); x < vx - 2; x += 2) f.fill(x, base - 1, 1, 1, C::divider);
    if (lines[i].name) roll_named(f, FONT_SMALL, lines[i].name, lines[i].value, RIGHT, WIDE - 1, base, lines[i].color);
    else f.text(FONT_SMALL, lines[i].value, vx, base, lines[i].color);
  }
}

// ---- radar ----

static int radar_value(const std::vector<uint8_t> &data, int i, int w = 64) {
  // w x 32 bytes (one a pixel, as from the server), or half that packed (two
  // a byte, left pixel in the high nibble).
  if (data.size() == (size_t)w * 32) return data[i];
  if ((size_t)(i >> 1) >= data.size()) return 0;
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

static const RGB PEEK_LOADED = hexc(0x6a6a6a);

// Wide board (draw.js renderRadarWide; wide-spec §5): the 128 x 32 map, the
// time on a black chip bottom-right (at least columns 101-127), a watch or
// warning (else the temperature) on a chip bottom-left, the frame dots with
// black gaps, along row 31 or just above the left chip.
static const int WIDE_CHIP_X = 101, WIDE_CHIP_Y = 26;  // chips: rows 26-31
static const RGB WIDE_DOT = hexc(0x4a4a4a);
template <class OnHand>
static void render_radar_wide(const Value &p, const Value &r, Frame &f, const Value &ids, int idx,
                              const std::vector<uint8_t> *data, std::optional<double> now_o, bool blink, bool peek,
                              const OnHand &on_hand) {
  f.w = WIDE;
  if (data && !data->empty()) {
    const Value &rbv = r["rb"];
    RadarColors rc = radar_colors(r.has("rb") ? (rbv.is_null() ? 100 : rbv.num()) : 100);
    for (int y = 0; y < 32; y++)
      for (int x = 0; x < WIDE; x++) {
        int v = radar_value(*data, y * WIDE + x, WIDE);
        if (v >= 0 && v < 16 && rc.on[v]) f.fill(x, y, 1, 1, rc.c[v]);
      }
  }
  int nids = (int)ids.size();
  double now_s = now_o ? *now_o : p["now"].num();
  bool now_clock = r["clock"].eq("now");
  const Value &ft = r["ft"];
  double t = !now_clock && idx >= 0 && ft.truthy() && !ft[idx].is_null() ? ft[idx].num() : now_s;
  double tzo = p["tzo"].num(0);
  const Value *warnp = p["warn"].truthy() ? &p["warn"] : nullptr;
  std::optional<WarnStyle> ws;
  if (warnp) ws = warn_style(*warnp);
  bool hide_warn = ws && ws->blinks && blink;
  bool show_time = !r["showTime"].is_false() && !r["clock"].eq("none");
  const RGB black{0, 0, 0};
  const int ch = 32 - WIDE_CHIP_Y;
  // The time chip: AM/PM at the right edge, the time before it.
  if (show_time && r["clock"].eq("age")) {
    double fts = idx >= 0 && ft.truthy() && !ft[idx].is_null() ? ft[idx].num() : now_s;
    ustr age = num_text((long long)std::max(0.0, floor((now_s - fts + 30) / 60))) + U"m";
    f.fill(WIDE_CHIP_X, WIDE_CHIP_Y, WIDE - WIDE_CHIP_X, ch, black);
    f.text(FONT_SMALL, age, WIDE - measure(FONT_SMALL, age), 32, C::label);
  } else if (show_time) {
    ustr ap = ampm_text(t, tzo), clk = clock_text(t, tzo);
    int ap_x = WIDE - measure(FONT_SMALL, ap);
    int right = ap_x - 3;
    std::optional<Roll> cr;
    if (now_clock) cr = take_roll("rad.clock", clk);
    int x = right - measure(FONT_SMALL, clk) + 1;
    if (cr) x = std::min(x, right - measure(FONT_SMALL, cr->from) + 1);
    int x0 = std::min(WIDE_CHIP_X, x - 1);
    f.fill(x0, WIDE_CHIP_Y, WIDE - x0, ch, black);
    roll_text(f, FONT_SMALL, clk, right, 32, C::label, cr);
    f.text(FONT_SMALL, ap, ap_x, 32, C::radarAmpm);
  }
  // The bottom-left chip: a watch or warning (in place of the temperature),
  // else the temperature; the frame dots above it.
  bool chip = false;
  if (ws) {
    ustr word = (*warnp)["lvl"].eq("warning") ? U"WARNING" : U"WATCH";
    int tw = measure(FONT_SMALL, ws->glyph) + TAG_GAP + measure(FONT_SMALL, word);
    f.fill(0, WIDE_CHIP_Y, tw + 1, ch, black);
    if (!hide_warn) {
      int gx = f.text(FONT_SMALL, ws->glyph, 0, 32, ws->color);
      f.text(FONT_SMALL, word, gx + TAG_GAP - 1, 32, ws->color);
    }
    chip = true;
  } else if (!r["temp"].is_null() && r.has("temp") && (r["cond"].truthy() || r["showTime"].is_false())) {
    ustr tt = vstr(r["temp"]) + U"°";
    int tw = measure(FONT_SMALL, tt);
    f.fill(0, WIDE_CHIP_Y, tw + 1, ch, black);
    f.text(FONT_SMALL, tt, 0, 32, C::label);
    chip = true;
  }
  int dy = chip ? WIDE_CHIP_Y - 1 : 31;
  if (nids) f.fill(0, dy, nids * 2 - 1, 1, black);
  for (int i = 0; i < nids; i++) f.fill(i * 2, dy, 1, 1, i == idx ? C::amber : peek && on_hand(i) ? PEEK_LOADED : WIDE_DOT);
}

static void render_weather(const Value &p, Frame &f, std::optional<double> now, std::optional<int> idx_o,
                           const Frames *frames, bool blink, bool peek = false) {
  const Value &r = p["radar"];
  const Value &ids = r["frames"];
  int nids = (int)ids.size();
  auto on_hand = [&](int i) { return frames && frames->count(json::str(ids[i])) > 0; };
  int idx;
  if (!ids.truthy()) idx = -1;
  else if (peek) {
    // Peek: the newest frame on hand, still; -1 with none yet.
    idx = -1;
    for (int i = nids - 1; i >= 0; i--)
      if (on_hand(i)) {
        idx = i;
        break;
      }
  } else if (idx_o) idx = std::max(0, std::min(nids - 1, *idx_o));
  else idx = nids - 1;
  const Value &wx = r["wx"];
  const Value *warnp = p["warn"].truthy() ? &p["warn"] : nullptr;
  // A peek never falls back for frames still downloading: it shows the
  // empty radar, its frame indicator filling in as they land.
  // (The rain bars were cut, Nov 2026: wx.rain is ignored.)
  if ((!ids.truthy() || (!peek && frames && !radar_on_hand(ids, frames))) && wx.truthy()) {
    bool shadow = r["tempShadow"].truthy();
    // Wide: 24 hours, the week, or the wide conditions; hours or days
    // without the wide data show the 64 layout on both panels.
    if (cols_of(p) == WIDE) {
      bool hours = wx["hours"].truthy() && wx["hours"].size(), days = wx["days"].truthy() && wx["days"].size();
      if (wx["hours24"].truthy() && wx["hours24"].size() >= 8) { f.w = WIDE; draw_day_hours(f, wx, shadow, warnp, blink); return; }
      if (wx["week"].truthy() && wx["week"].size() >= 7) { f.w = WIDE; draw_week(f, wx, shadow, warnp, blink); return; }
      if (!hours && !days) { f.w = WIDE; draw_conditions_wide(f, p, now ? *now : p["now"].num(), wx, shadow, warnp, blink); return; }
    }
    if (wx["hours"].truthy()) draw_hourly(f, wx, shadow, warnp, blink);
    else if (wx["days"].truthy()) draw_five_day(f, wx, shadow, warnp, blink);
    else draw_conditions(f, wx, shadow, warnp, blink);
    return;
  }
  const std::vector<uint8_t> *data = nullptr;
  if (idx >= 0 && frames && !frames->empty()) {
    auto it = frames->find(json::str(ids[idx]));
    if (it != frames->end()) data = &it->second;
  }
  if (r["wide"].truthy() && cols_of(p) == WIDE) {
    render_radar_wide(p, r, f, ids, idx, data, now, blink, peek, on_hand);
    return;
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
      f.fill(x, top, seg_w, 2, i == idx ? C::amber : peek && on_hand(i) ? PEEK_LOADED : C::indicator);
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
  if (!has_games(games)) return PickedGame{-1, 0, 0};
  std::vector<int> pool;
  if (!all_games)
    for (size_t i = 0; i < games.size(); i++)
      if (games[i]["st"].eq("live")) pool.push_back((int)i);
  if (pool.empty())
    for (size_t i = 0; i < games.size(); i++) pool.push_back((int)i);
  long long pos = fmod_floor((long long)floor(now / every), (long long)pool.size());
  return PickedGame{pool[pos], (int)pos, (int)pool.size()};
}

// Pregame's bottom line (draw.js drawFirstPitch): TODAY, the first pitch right-aligned.
static void draw_first_pitch(Frame &f, const Value &gm, double tzo) {
  f.text(FONT_SMALL, U"TODAY", 0, BB_BOTTOM, C::grey);
  ustr ap = ampm_text(gm["start"].num(), tzo);
  rtext(f, FONT_SMALL, ap, f.w - 1, BB_BOTTOM, C::grey);
  rtext(f, FONT_SMALL, clock_text(gm["start"].num(), tzo), f.w - 1 - measure(FONT_SMALL, ap) - 3, BB_BOTTOM, C::label);
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

static void draw_score(Frame &f, const ustr &text, int top, RGB color, const Roll *roll, int right = SCORE_RIGHT) {
  int base = top + 6;
  if (!roll || roll->from == text || roll->p >= 1) {
    rtext(f, FONT_5X7, text, right, base, color);
    return;
  }
  int up = (int)jsround(ease_in_out(roll->p) * SCORE_ROLL);
  f.push_clip(right - 12, top, right, top + 6);
  const ustr &frm = roll->from;
  if (frm.size() == text.size()) {
    int x = right - measure(FONT_5X7, text) + 1;
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
    rtext(f, FONT_5X7, frm, right, base - up, color);
    rtext(f, FONT_5X7, text, right, base - up + SCORE_ROLL, color);
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
  f.push_clip(0, base - 5, f.w - 1, base - 1);
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
  roll_named(f, FONT_CLOCK, "big.clock", clock, CENTER, 0, top + 10, C::clock, f.w);
  f.text(FONT_SMALL, label, (int)fdiv(f.w - measure(FONT_SMALL, label), 2), top + 18, C::noTrains);
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
    draw_first_pitch(f, gm, tzo);
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

// ---- baseball, wide (wide-spec §8); mirrors renderBaseballWide() in draw.js ----
static const int BW_INN_X = 26, BW_PITCH = 8, BW_COLS = 9, BW_DIV = 95, BW_COUNT_X = 30, BW_OUTS_X = 46;
static const int BW_RHE[] = {105, 117, 126};
static const int BW_TOPS[] = {9, 17};
static const RGB BW_HEAD = hexc(0x4a4a4a);

static void render_baseball_wide(Frame &f, const Value &gm, double now, double tzo, const Rolls &rolls) {
  bool live = gm["st"].eq("live"), final = gm["st"].eq("final");
  std::string winner = winner_of(gm);
  const char *keys[] = {"away", "home"};
  int name_end = 0;
  for (int s = 0; s < 2; s++) {
    const Value &side = gm[keys[s]];
    int top = BW_TOPS[s];
    f.fill(0, top, 3, 6, side["c"].truthy() ? hexs(side["c"].str_or("")) : C::grey);
    name_end = std::max(name_end, f.text(FONT_5X7, vstr(side["ab"]), 5, top + 6, winner == keys[s] ? C::amber : C::label));
  }
  f.fill(0, BB_DIVIDER, f.w, 1, C::divider);

  if (gm["st"].eq("pre")) {
    for (int s = 0; s < 2; s++) f.text(FONT_SMALL, bb_record(gm[keys[s]]), name_end + 2, BW_TOPS[s] + 6, C::grey);
    draw_first_pitch(f, gm, tzo);
    return;
  }

  const Value &rs_a = gm["away"]["rs"], &rs_h = gm["home"]["rs"];
  int len_a = rs_a.truthy() ? (int)rs_a.size() : 0, len_h = rs_h.truthy() ? (int)rs_h.size() : 0;
  int cur = live ? (gm["inn"].truthy() ? (int)gm["inn"].num() : 1) : 0;
  int last = std::max(std::max(BW_COLS, len_a), std::max(len_h, cur));
  int first = last - BW_COLS + 1;
  f.fill(BW_DIV, 0, 1, BB_DIVIDER, C::divider);
  for (int i = 0; i < BW_COLS; i++) {
    int inn = first + i, cx = BW_INN_X + i * BW_PITCH;
    ctext(f, FONT_SMALL, num_text(inn), cx, 6, inn == cur ? C::amber : BW_HEAD);
    for (int s = 0; s < 2; s++) {
      const Value &rs = s == 0 ? rs_a : rs_h;
      int len = s == 0 ? len_a : len_h;
      bool has = inn - 1 < len && !rs[inn - 1].is_null();
      bool bat = inn == cur && (s == 0 ? gm["half"].eq("T") : gm["half"].eq("B"));
      ustr str = has ? num_text((long long)rs[inn - 1].num()) : bat ? ustr(U"0") : final && s == 1 && inn <= len_a ? ustr(U"X") : ustr();
      if (!str.empty()) ctext(f, FONT_SMALL, str, cx, BW_TOPS[s] + 6, bat ? C::amber : C::grey);
    }
  }
  static const char32_t *const RHE[] = {U"R", U"H", U"E"};
  for (int i = 0; i < 3; i++) ctext(f, FONT_SMALL, RHE[i], BW_RHE[i] - 2, 6, BW_HEAD);
  for (int s = 0; s < 2; s++) {
    const Value &side = gm[keys[s]];
    RGB color = final ? (winner == keys[s] ? C::amber : !winner.empty() ? BB_LOSE : C::label) : score_color(side, now);
    draw_score(f, vstr(side["r"]), BW_TOPS[s], color, roll_of(rolls, keys[s]), BW_RHE[0]);
    rtext(f, FONT_5X7, num_text(side["h"].truthy() ? (long long)side["h"].num() : 0), BW_RHE[1], BW_TOPS[s] + 6, C::grey);
    rtext(f, FONT_5X7, num_text(side["e"].truthy() ? (long long)side["e"].num() : 0), BW_RHE[2], BW_TOPS[s] + 6, C::grey);
  }

  if (final) {
    f.text(FONT_SMALL, U"FINAL", 0, BB_BOTTOM, C::label);
    return;
  }
  LiveTexts t = live_texts(gm);
  draw_roll_text(f, t.inn, 0, BB_BOTTOM, C::label, roll_of(rolls, "inn"), 0);
  draw_roll_text(f, t.count, BW_COUNT_X, BB_BOTTOM, C::label, roll_of(rolls, "count"), BW_COUNT_X);
  draw_roll_text(f, t.outs, BW_OUTS_X, BB_BOTTOM, C::grey, roll_of(rolls, "outs"), BW_OUTS_X);
  const Value &on = gm["on"];
  auto base_on = [&](int i) { return on.truthy() ? on[i].truthy() : false; };
  draw_diamond(f, 125, 29, 1, base_on(0) ? C::amber : BB_BASE, true);
  draw_diamond(f, 122, 27, 1, base_on(1) ? C::amber : BB_BASE, true);
  draw_diamond(f, 119, 29, 1, base_on(2) ? C::amber : BB_BASE, true);
}

static void render_baseball(const Value &p, Frame &f, std::optional<double> now_o, std::optional<int> game,
                            const Rolls *rolls_in, const Logos *logos) {
  if (cols_of(p) == WIDE) f.w = WIDE;
  double now = now_o ? *now_o : p["now"].num();
  double tzo = p["tzo"].num(0);
  const Value &mlb = p["mlb"];
  const Value &games = mlb["games"];
  if (!has_games(games)) {
    draw_no_games(f, now, tzo);
    return;
  }
  int gi = game ? (int)fmod_floor(*game, (long long)games.size())
                : pick_game(games, now, timing(p).game, mlb["all"].is_true()).i;
  const Value &gm = games[gi];
  static const Rolls empty;
  const Rolls &rolls = rolls_in ? *rolls_in : empty;
  if (f.w == WIDE) {
    render_baseball_wide(f, gm, now, tzo, rolls);
    return;
  }
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
    draw_first_pitch(f, gm, tzo);
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
  if (!has_games(games)) return std::nullopt;
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

// ---- knob chooser (renderChooser) ----

static const double CHOOSER_PITCH = 38;

static void render_chooser(const Value &p, Frame &f, double pos, bool commit) {
  const Value &ring = p["knob"]["ring"];
  int n = (int)ring.size();
  if (!n) return;
  int sel = (int)fmod_floor((long long)jsround(pos), n);
  for (int k = 0; k < n; k++) {
    double d = k - pos - n * std::floor((k - pos + n / 2.0) / n);  // wrapped into [-n/2, n/2)
    double ad = std::abs(d);
    if (ad > 1.6) continue;
    bool big = ad < 0.5;
    if (commit && !big) continue;
    std::string s = json::str(ring[k]);
    for (char &ch : s)
      if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 'a' + 'A');
    ustr name = U(s);
    Font font = big ? FONT_5X7 : FONT_SMALL;
    RGB color = big && commit ? C::amber : lerp_color(C::label, C::dimHead, std::min(1.0, ad));
    f.text(font, name, (int)jsround(32 + d * CHOOSER_PITCH - measure(font, name) / 2.0), big ? 7 : 6, color);
  }
  int x0 = 32 - (int)fdiv(n * 5 - 2, 2);
  for (int i = 0; i < n; i++) f.fill(x0 + i * 5, 9, 3, 1, i == sel ? C::amber : C::indicator);
}


// ---- peek chooser (renderPeek, PEEK) ----
// The chosen category's variant itself, drawn from the payload's sections
// and `pv`, under the icon bar on rows 21-31. Mirrors draw.js.

static const int PEEK_TOP = 21, PEEK_PITCH = 12;
static const char *const PEEK_ICON_TRANSIT[] = {".#####.", "#.....#", "#.....#", "#######", "##...##", ".#####.", "#.....#"};
static const char *const PEEK_ICON_WEATHER[] = {"...#...", ".#...#.", "..###..", "#.###.#", "..###..", ".#...#.", "...#..."};
static const char *const PEEK_ICON_CLOCK[] = {"..###..", ".#...#.", "#..#..#", "#..##.#", "#.....#", ".#...#.", "..###.."};
static const char *const PEEK_ICON_ANNOUNCE[] = {"#######", "#.....#", "#.###.#", "#.....#", "#######", ".##....", ".#....."};
static const char *const PEEK_ICON_CYCLE[] = {"..###.#", ".#...##", "#...###", "#.....#", "###...#", "##...#.", "#.###.."};
static const RGB PEEK_WEATHER = hexc(0xffd040), PEEK_CLOCK = hexc(0xf0e2c8), PEEK_ANNOUNCE = hexc(0x40e090),
                 PEEK_CYCLE = hexc(0x3fd0e8);

static const char *const *peek_icon(const std::string &cat) {
  if (cat == "transit") return PEEK_ICON_TRANSIT;
  if (cat == "weather") return PEEK_ICON_WEATHER;
  if (cat == "clock") return PEEK_ICON_CLOCK;
  if (cat == "announce") return PEEK_ICON_ANNOUNCE;
  if (cat == "cycle") return PEEK_ICON_CYCLE;
  return nullptr;
}

static RGB peek_color(const Value &p, const std::string &cat) {
  (void)p;
  if (cat == "transit") return line_color("RD");  // always Red Line red, whatever the station
  if (cat == "weather") return PEEK_WEATHER;
  if (cat == "clock") return PEEK_CLOCK;
  if (cat == "announce") return PEEK_ANNOUNCE;
  if (cat == "cycle") return PEEK_CYCLE;
  return C::label;
}

static double peek_ease(double k) {
  double c = std::max(0.0, std::min(1.0, k));
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

int peek_shift(bool y, double t, int w) { return (int)jsround(peek_ease(t / (y ? PEEK_Y_MS : PEEK_X_MS)) * (y ? 32 : w)); }

int peek_drop(bool up, double t) {
  return (int)jsround((up ? 1 - peek_ease(t / PEEK_UP_MS) : peek_ease(t / PEEK_DOWN_MS)) * PEEK_BAND);
}

// The cycle symbol (the phone's two arrows, anti-aliased): 16 levels of
// cyan in a 20x20 box at x22, y6.
static const char *const CYCLE_ART[] = {
    "0000028cffffc8206400", "00008effffffffe9f600", "001bffe844448efff800", "00bff810000009fffb00", "08ff600000006efffd00",
    "2ef80000000000258b00", "8fe10000000000000000", "cf800000000000000000", "ff400000000000000000", "ff4000000000000000ee",
    "ee0000000000000004ff", "000000000000000004ff", "000000000000000008fc", "00000000000000001ef8", "00b85200000000008fe2",
    "00dfffe600000006ff80", "00bfff900000018ffb00", "008fffe844448effb100", "006f9effffffffe80000", "0046028cffffc8200000"};

static void draw_cycle_art(Frame &f) {
  for (int j = 0; j < 20; j++)
    for (int i = 0; i < 20; i++) {
      char ch = CYCLE_ART[j][i];
      int lv = ch >= 'a' ? ch - 'a' + 10 : ch - '0';
      if (lv)
        f.set(22 + i, 6 + j, RGB{(uint8_t)jsround(PEEK_CYCLE.r * lv / 15.0), (uint8_t)jsround(PEEK_CYCLE.g * lv / 15.0),
                                 (uint8_t)jsround(PEEK_CYCLE.b * lv / 15.0)});
    }
}

// Object member to write (added at the end when missing), and removal.
static Value &member(Value &o, const char *key) {
  if (o.type != json::OBJ) {
    o = Value();
    o.type = json::OBJ;
  }
  for (auto &kv : o.o)
    if (kv.first == key) return kv.second;
  o.o.emplace_back(key, Value());
  return o.o.back().second;
}
static Value str_value(const std::string &s) {
  Value v;
  v.type = json::STR;
  v.s = s;
  return v;
}

std::string peek_screen(const Value &p, int k, int vi) {
  const Value &kn = p["knob"], &c = kn["ring"][k], &vv = kn["vars"][k][vi];
  std::string cat = c.is_str() ? c.s : "";
  if (cat == "transit") return vv.eq("ticker") ? "ticker" : "transit";
  if (cat == "weather" || cat == "clock" || cat == "announce") return cat;
  return "cycle";
}

// An object overlaying `base`: its own members win, the rest come from base.
static Value overlay(const Value &base) {
  Value v;
  v.type = json::OBJ;
  v.base = base.is_obj() ? &base : nullptr;
  return v;
}

PeekView peek_view(const Value &p, int k, int vi) {
  // Weather and clock views are overlays on the payload: only the members
  // they change are their own (a few small arrays and objects), the rest is
  // read through from p. So a view costs a few hundred bytes, not a copy of
  // the payload, and p must outlive it (the Board rebuilds views on every
  // new payload). Null members stand in for draw.js's deleted ones.
  PeekView out;
  out.screen = peek_screen(p, k, vi);
  const Value &kn = p["knob"];
  std::string cat = kn["ring"][k].is_str() ? kn["ring"][k].s : "";
  const Value &vv = kn["vars"][k][vi];
  std::string v = vv.is_str() ? vv.s : "";
  const Value &pv = p["pv"];
  if (cat == "weather") {
    // The radar view: every kept frame (pv.radar), rain or not. The
    // others: the radar loop only while rain is in the box (radar.on).
    out.own = true;
    out.v = overlay(p);
    const Value &r = p["radar"], &all = pv["radar"];
    bool radar_view = v == "radar";
    Value frames, ft;
    frames.type = ft.type = json::ARR;
    if (radar_view) {
      frames = all["frames"].truthy() ? all["frames"] : r["frames"].truthy() ? r["frames"] : frames;
      ft = all["ft"].truthy() ? all["ft"] : r["ft"].truthy() ? r["ft"] : ft;
    } else if (r["on"].truthy()) {
      if (r["frames"].truthy()) frames = r["frames"];
      if (r["ft"].truthy()) ft = r["ft"];
    }
    Value &nr = member(out.v, "radar");
    nr = overlay(r);
    member(nr, "frames") = frames;
    member(nr, "ft") = ft;
    if (r["wx"].truthy()) {
      Value &wx = member(nr, "wx");
      wx = overlay(r["wx"]);
      member(wx, "days") = v == "5day" && pv["days"].truthy() ? pv["days"] : Value();
      member(wx, "hours") = v == "hourly" && pv["hours"].truthy() ? pv["hours"] : Value();
      member(wx, "week") = v == "5day" && pv["week"].truthy() ? pv["week"] : Value();
      member(wx, "hours24") = v == "hourly" && pv["hours24"].truthy() ? pv["hours24"] : Value();
    } else {
      member(nr, "wx") = Value();
    }
    return out;
  }
  if (cat == "clock") {
    out.own = true;
    out.v = overlay(p);
    member(out.v, "cface") = str_value(v.empty() ? "skyline" : v);
    // Each face's object read through from pv (the skyline's is large).
    for (const char *key : {"skyline", "cwx", "dn", "cacc", "cdig"}) member(out.v, key) = !pv[key].truthy() ? Value() : pv[key].is_obj() ? overlay(pv[key]) : pv[key];
    for (const char *key : {"ginv", "steady"}) {
      Value g;
      g.type = json::BOOL;
      g.b = pv[key].truthy();
      member(out.v, key) = g;
    }
    return out;
  }
  return out;
}

static void render_clock(const Value &p, Frame &f, const RenderOpts &o);
static void render_announce(const Value &p, Frame &f, std::optional<double> t);

// On a wide board every view is 128 across (64-wide ones on both panels).
static void draw_peek_view(const Value &q, const std::string &screen, Frame &f, const RenderOpts &o) {
  f.clear();
  if (screen == "cycle") draw_cycle_art(f);
  else if (screen == "ticker") render_ticker(q, f, o.now, o.page, o.slide);
  else if (screen == "weather") render_weather(q, f, o.now, o.idx, o.frames, o.blink, true);
  else if (screen == "clock") render_clock(q, f, o);
  else if (screen == "announce") render_announce(q, f, o.t);
  else render_transit(q, f, o.now, o.blink, o.view);
  widen(f, cols_of(q));
}

// Wide board (draw.js drawPeekBarWide; wide-spec §9): the chosen
// category's icon at x2 with its underline, its variants as words from x14
// (the chosen white), shifted left by whole words to show the chosen one in
// columns 14-123; a category without variants shows its name in its color;
// one dot per category on column 126.
static const int PW_X0 = 14, PW_RIGHT = 123, PW_GAP = 5, PW_DOT_X = 126;
static const RGB PW_OFF = hexc(0x4a4a4a);
static ustr peek_name(const std::string &v, bool week) {
  static const char *const names[][2] = {{"transit", "ROWS"}, {"rows", "ROWS"}, {"ticker", "TICKER"}, {"now", "NOW"}, {"5day", "5-DAY"},
                                         {"hourly", "HOURLY"}, {"radar", "RADAR"}, {"skyline", "SKY"}, {"seventies", "70S"}, {"analog", "DIAL"},
                                         {"daynight", "MAP"}, {"gradient", "GRAD"}, {"digits", "BIG"}, {"daydate", "DATE"}, {"words", "WORDS"}};
  if (v == "5day" && week) return U"7-DAY";
  for (const auto &n : names)
    if (v == n[0]) return U(n[1]);
  std::string up = v;
  for (char &c : up) c = (char)toupper((unsigned char)c);
  return U(up);
}
static ustr peek_cat_name(const std::string &cat) {
  static const char *const names[][2] = {{"transit", "TRANSIT"}, {"weather", "WEATHER"}, {"clock", "CLOCK"}, {"announce", "ANNOUNCE"}, {"cycle", "CYCLE"}};
  for (const auto &n : names)
    if (cat == n[0]) return U(n[1]);
  std::string up = cat;
  for (char &c : up) c = (char)toupper((unsigned char)c);
  return U(up);
}
static void draw_peek_bar_wide(Frame &f, const Value &p, int k, int vi, int drop) {
  const Value &kn = p["knob"], &ring = kn["ring"];
  auto sh = [&](int y) { return y + drop; };
  std::string cat = ring[k].is_str() ? ring[k].s : "";
  RGB col = peek_color(p, cat);
  if (const char *const *rows = peek_icon(cat))
    for (int j = 0; j < 7; j++)
      for (int x = 0; x < 7; x++)
        if (rows[j][x] == '#') f.fill(2 + x, sh(23 + j), 1, 1, col);
  f.fill(2, sh(31), 7, 1, col);
  const Value &vars = kn["vars"][k];
  int nv = (int)vars.size();
  if (nv > 1) {
    bool week = p["pv"]["week"].truthy();
    std::vector<ustr> words;
    std::vector<int> xs;
    int x = PW_X0;
    for (int i = 0; i < nv; i++) {
      words.push_back(peek_name(vars[i].is_str() ? vars[i].s : "", week));
      xs.push_back(x);
      x += measure(FONT_SMALL, words.back()) + 1 + PW_GAP;
    }
    // A variant past the list (a payload changed under the chooser): no
    // shift, none lit, as draw.js.
    int shift = 0;
    if (vi >= 0 && vi < nv) {
      int end = xs[vi] + measure(FONT_SMALL, words[vi]) - 1;
      for (int j = 0; end - shift > PW_RIGHT && j < vi; j++) shift = xs[j + 1] - PW_X0;
    }
    f.push_clip(PW_X0, 0, PW_RIGHT, 31);
    for (int i = 0; i < nv; i++) f.text(FONT_SMALL, words[i], xs[i] - shift, sh(29), i == vi ? C::white : PW_OFF);
    f.pop_clip();
  } else {
    f.text(FONT_SMALL, peek_cat_name(cat), PW_X0, sh(29), col);
  }
  for (int i = 0; i < (int)ring.size(); i++) {
    RGB dc = peek_color(p, ring[i].is_str() ? ring[i].s : "");
    f.fill(PW_DOT_X, sh(22 + i * 2), 1, 1, i == k ? dc : scale_color(dc, 0.3));
  }
}

static void draw_peek_bar(Frame &f, const Value &p, int k, int vi, int drop) {
  const Value &kn = p["knob"], &ring = kn["ring"];
  int n = (int)ring.size();
  auto sh = [&](int y) { return y + drop; };
  f.fill(0, sh(PEEK_TOP), f.w, PEEK_BAND, RGB{0, 0, 0});
  if (f.w == WIDE) return draw_peek_bar_wide(f, p, k, vi, drop);
  int x0 = (int)std::floor(f.w / 2.0 - (n * PEEK_PITCH - 5) / 2.0);
  for (int i = 0; i < n; i++) {
    std::string cat = ring[i].is_str() ? ring[i].s : "";
    const char *const *rows = peek_icon(cat);
    if (!rows) continue;
    RGB col = peek_color(p, cat);
    RGB c = i == k ? col : scale_color(col, 0.3);
    for (int j = 0; j < 7; j++)
      for (int x = 0; x < 7; x++)
        if (rows[j][x] == '#') f.fill(x0 + i * PEEK_PITCH + x, sh(23 + j), 1, 1, c);
  }
  int ix = x0 + k * PEEK_PITCH;
  std::string kc = ring[k].is_str() ? ring[k].s : "";
  RGB col = peek_color(p, kc);
  f.fill(ix, sh(31), 7, 1, col);
  int nv = (int)kn["vars"][k].size();
  if (nv > 1)
    for (int j = 0; j < nv; j++) f.fill(ix + 8, sh(26 - (nv - 1) + j * 2), 1, 1, j == vi ? col : C::indicator);
}

static void render_peek(const Value &p, Frame &f, const RenderOpts &o) {
  RenderOpts::Peek pk = o.peek ? *o.peek : RenderOpts::Peek{};
  int drop = std::max(0, std::min(PEEK_BAND, pk.drop));
  RenderOpts vo = o;  // the views: no skyline crossfade, the peek's own frames
  vo.sky = nullptr;
  vo.sky_from = nullptr;
  vo.peek.reset();
  if (pk.view) draw_peek_view(*pk.view, peek_screen(p, pk.k, pk.vi), f, vo);
  else {
    PeekView pv = peek_view(p, pk.k, pk.vi);
    draw_peek_view(pv.payload(p), pv.screen, f, vo);
  }
  if (pk.slide) {
    const int W = f.w;
    int sh = peek_shift(pk.slide_y, pk.slide_t, W);
    if (sh < (pk.slide_y ? 32 : W)) {
      // Kept, not on the loop task's small stack; in PSRAM on the board.
      static Frame &from = *big_frame();
      static uint8_t *const cur = big_bytes(Frame::MAX_W * Frame::H * 3);
      from.clear();
      if (pk.slide_view) draw_peek_view(*pk.slide_view, peek_screen(p, pk.slide_k, pk.slide_vi), from, vo);
      else {
        PeekView fv = peek_view(p, pk.slide_k, pk.slide_vi);
        draw_peek_view(fv.payload(p), fv.screen, from, vo);
      }
      memcpy(cur, f.px, f.bytes());
      int dir = pk.slide_dir < 0 ? -1 : 1;
      for (int y = 0; y < 32; y++)
        for (int x = 0; x < W; x++) {
          const uint8_t *src = from.px;
          int sx = x, sy = y;
          if (!pk.slide_y) {
            sx = x + dir * sh;
            if (sx < 0 || sx >= W) src = cur, sx = (int)fmod_floor(sx, W);
          } else {
            sy = y + dir * sh;
            if (sy < 0 || sy >= 32) src = cur, sy = (int)fmod_floor(sy, 32);
          }
          int i = (y * W + x) * 3, j = (sy * W + sx) * 3;
          f.px[i] = src[j];
          f.px[i + 1] = src[j + 1];
          f.px[i + 2] = src[j + 2];
        }
    }
  }
  if (drop < PEEK_BAND) draw_peek_bar(f, p, pk.k, pk.vi, drop);
}

// ---- clock screen: skyline face (design spec §14; contract "Skyline") ----
// Mirrors renderSkyline() and SKY in draw.js line for line. Plain
// arithmetic and an integer hash only, so the pixels match draw.js exactly.

static uint32_t ih(long long a, long long b, long long c) {
  uint32_t h = ((uint32_t)a * 0x9E3779B1u) ^ ((uint32_t)b * 0x85EBCA77u) ^ ((uint32_t)c * 0xC2B2AE3Du);
  h = (h ^ (h >> 15)) * 0x2C1B3C6Du;
  h = (h ^ (h >> 12)) * 0x297A2D39u;
  return h ^ (h >> 15);
}

static RGB mix_rgb(RGB a, RGB b, double k) {
  auto ch = [k](int v, int w) { double r = jsround(v + (w - v) * k); return (uint8_t)(r < 0 ? 0 : r > 255 ? 255 : r); };
  return RGB{ch(a.r, b.r), ch(a.g, b.g), ch(a.b, b.b)};
}
static double sstep01(double a, double b, double v) {
  double t = std::max(0.0, std::min(1.0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
static double wave(double ph) {
  double u = ph - std::floor(ph), tri = u < 0.5 ? u * 2 : 2 - u * 2;
  return tri * tri * (3 - 2 * tri);
}
static RGB hsv_rgb(double h, double s, double v) {
  auto f = [&](double n) { double k = std::fmod(n + h / 60, 6); return v - v * s * std::max(0.0, std::min(std::min(k, 4 - k), 1.0)); };
  return RGB{(uint8_t)jsround(f(5) * 255), (uint8_t)jsround(f(3) * 255), (uint8_t)jsround(f(1) * 255)};
}

namespace sky {
// The scene's geometry (draw.js buildSky): the 64 scene, or the wide
// board's panorama (W 128, the 64 scene O = 32 px in, towers either side).
const int SHORE = 25, CY = 17, R = 6, SPREAD = 5;
struct Win { int x, y; uint32_t th; bool bright; };
struct Star { int x, y; bool bright, tw; uint32_t ph; double per; };
struct Ant { int x, t, roof; bool beacon; };
struct RimPx { int x, y; double deg; };
struct Geometry {
  int W = 64, O = 0, CX = 32;
  std::vector<uint8_t> role;  // W x 32
  std::vector<Ant> ants;
  std::vector<Win> wins;
  std::vector<Star> stars;
  std::vector<std::pair<int, int>> legs;
  int bar[3] = {0, 0, 0};
  std::vector<RimPx> rim;
  bool isB(int x, int y) const { return x >= 0 && x < W && y >= 0 && y <= SHORE && role[y * W + x] != 0; }
};

static void rect(Geometry &g, int x, int w, int t, uint8_t r) {
  for (int y = std::max(0, t); y <= SHORE; y++)
    for (int i = x; i < x + w; i++)
      if (i >= 0 && i < g.W) g.role[y * g.W + i] = r;
}
static int top(int rows) { return SHORE + 1 - rows; }
static bool seg(double ax, double ay, double bx, double by, double px, double py) {
  double vx = bx - ax, vy = by - ay;
  double t = std::max(0.0, std::min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  double ex = px - (ax + t * vx), ey = py - (ay + t * vy);
  return ex * ex + ey * ey < 0.25;
}
template <typename F>
static std::vector<std::pair<int, int>> cover(int CX, F test) {
  std::vector<std::pair<int, int>> out;
  for (int y = CY - R - 2; y <= SHORE; y++)
    for (int x = CX - R - 2; x <= CX + R + 1; x++) {
      int hit = 0;
      for (int j = 0; j < 6; j++)
        for (int i = 0; i < 6; i++)
          if (test(x + (i + 0.5) / 6, y + (j + 0.5) / 6)) hit++;
      if (hit * 2 >= 36) out.push_back({x, y});
    }
  return out;
}

// The wide panorama's extra buildings [x, width, rows, role] and antennas
// [x, top rows, roof rows, beacon] (draw.js SKYW).
static const int WIDE_EXTRA[][4] = {
    {0, 5, 6, 1}, {5, 4, 8, 1}, {10, 3, 5, 1}, {13, 5, 7, 1}, {18, 4, 9, 1}, {22, 3, 6, 1}, {25, 4, 8, 1}, {29, 3, 6, 1},
    {2, 3, 11, 2}, {7, 3, 16, 2}, {14, 3, 13, 2}, {20, 4, 10, 2}, {26, 3, 12, 2},
    {96, 4, 8, 1}, {100, 5, 10, 1}, {105, 4, 7, 1}, {109, 5, 9, 1}, {114, 4, 8, 1}, {118, 5, 10, 1}, {123, 5, 8, 1},
    {97, 3, 13, 2}, {102, 4, 15, 2}, {107, 3, 11, 2}, {111, 4, 16, 2}, {116, 3, 12, 2}, {120, 4, 14, 2}, {125, 3, 12, 2}};
static const int WIDE_ANTS[][4] = {{8, 19, 16, 0}, {112, 19, 16, 0}};

static void build(Geometry &g, bool wide) {
  g.W = wide ? 128 : 64;
  g.role.assign((size_t)g.W * 32, 0);
  g.O = wide ? 32 : 0;
  g.CX = 32 + g.O;
  const int W = g.W, O = g.O, CX = g.CX;
  static const int mass[][3] = {{0, 4, 7}, {8, 3, 9}, {19, 3, 8}, {22, 3, 10}, {28, 3, 7}, {36, 3, 6},
                                {39, 4, 9}, {43, 3, 11}, {46, 4, 8}, {50, 3, 10}, {57, 4, 9}, {61, 3, 7}};
  for (const auto &m : mass) rect(g, m[0] + O, m[1], top(m[2]), 1);
  if (wide) {
    for (const auto &e : WIDE_EXTRA) if (e[3] == 1) rect(g, e[0], e[1], top(e[2]), 1);
    for (const auto &e : WIDE_EXTRA) if (e[3] == 2) rect(g, e[0], e[1], top(e[2]), 2);
  }
  rect(g, 1 + O, 1, top(9), 2); rect(g, 2 + O, 4, top(15), 2); rect(g, 6 + O, 2, top(13), 2); rect(g, 8 + O, 2, top(9), 2);  // Willis
  rect(g, 11 + O, 4, top(17), 2);                                                                                             // Aon
  rect(g, 15 + O, 5, top(21), 2);                                                                                             // St. Regis
  rect(g, 23 + O, 5, top(10), 2); rect(g, 24 + O, 4, top(13), 2); rect(g, 24 + O, 3, top(16), 2);                             // Trump
  rect(g, 29 + O, 7, top(15), 2); rect(g, 30 + O, 5, top(17), 2);                                                             // Lake Point Tower
  {
    int t = top(17), steps[3] = {4, 6, 8};                                                                                    // Hancock
    for (int y = t; y <= SHORE; y++) {
      int w = steps[std::min(2, (int)fdiv((y - t) * 3, SHORE - t + 1))];
      for (int i = 53 + O - w / 2; i < 53 + O + w / 2; i++) g.role[y * W + i] = 2;
    }
  }
  g.ants = {{2 + O, top(18), top(15), false}, {4 + O, top(17), top(15), false}, {51 + O, top(22), top(17), true}, {54 + O, top(22), top(17), true}};
  if (wide)
    for (const auto &a : WIDE_ANTS) g.ants.push_back({a[0], top(a[1]), top(a[2]), a[3] != 0});
  for (int y = 1; y <= SHORE; y++)
    for (int x = 0; x < W; x++) {
      int r = g.role[y * W + x];
      if (!r || (r == 1 && x < 38 + O) || (x >= 19 + O && x <= 44 + O && y >= SHORE - 6)) continue;
      double dx = x + 0.5 - CX, dy = y + 0.5 - CY;
      if (dx * dx + dy * dy < 49 || x % 2 != 0 || y % 2 != 1 || !g.isB(x, y - 1)) continue;
      g.wins.push_back({x, y, ih(x, y, 5) % 1000, ih(x, y, 9) % 10 < 3});
    }
  static const double pers[3] = {4000, 6000, 12000};
  const size_t nstars = wide ? 28 : 14;
  const int tries = wide ? 2000 : 1000;
  for (int i = 0; g.stars.size() < nstars && i < tries; i++) {
    int x = (int)(ih(i, 1, 3) % W), y = (int)(ih(i, 2, 3) % 14);
    double dx = x + 0.5 - CX, dy = y + 0.5 - CY;
    bool dup = false;
    for (const Star &st : g.stars) dup = dup || (st.x == x && st.y == y);
    if (g.isB(x, y) || (x > 35 + O && x < 49 + O && y < 11) || (x >= 50 + O && x <= 55 + O && y < 10) || dx * dx + dy * dy < 90.25 || dup) continue;  // not between the Hancock antennas
    g.stars.push_back({x, y, ih(i, 3, 3) % 10 < 3, ih(i, 4, 3) % 2 == 1, ih(i, 5, 3) % 1000, pers[g.stars.size() % 3]});
  }
  g.legs = cover(CX, [CX](double x, double y) {
    double dx = x - CX, dy = y - CY;
    return dx * dx + dy * dy > 0.36 && (seg(CX, CY, CX - SPREAD, SHORE + 1, x, y) || seg(CX, CY, CX + SPREAD, SHORE + 1, x, y));
  });
  double kb = (SHORE - 1 + 0.5 - CY) / (double)(SHORE + 1 - CY);
  g.bar[0] = (int)jsround(CX - SPREAD * kb); g.bar[1] = SHORE - 1; g.bar[2] = (int)jsround(2 * SPREAD * kb);
  for (const auto &p : cover(CX, [CX](double x, double y) {
         double dx = x - CX, dy = y - CY, d2 = dx * dx + dy * dy;
         return d2 >= (R - 1) * (R - 1) && d2 <= R * R;
       })) {
    double dx = p.first + 0.5 - CX, dy = p.second + 0.5 - CY, ax = std::abs(dx), ay = std::abs(dy);
    double pa = dy >= 0 ? (dx >= 0 ? dy / (ax + ay) : 1 + ax / (ax + ay)) : (dx < 0 ? 2 + ay / (ax + ay) : 3 + ax / (ax + ay));
    g.rim.push_back({p.first, p.second, pa * 90});
  }
}
// Built on first use (the wide one only on a wide board).
static const Geometry &geo(bool wide = false) {
  static Geometry g[2];
  static bool built[2] = {false, false};
  if (!built[wide]) {
    build(g[wide], wide);
    built[wide] = true;
  }
  return g[wide];
}

const RGB WHEEL_LEG[3] = {hexc(0x565c68), hexc(0x4a505c), hexc(0x262a32)};
const RGB WHEEL_RIM[3] = {hexc(0xdce0e6), hexc(0xeef0f4), hexc(0x262a32)};
const RGB WHEEL_NIGHT = hexc(0x4a4a66), PIER_DAY0 = hexc(0x6a6460), PIER_DAY1 = hexc(0x2e2a2c), PIER_NIGHT0 = hexc(0x2a2834),
          PIER_NIGHT1 = hexc(0x14121a), PIER_BULB = hexc(0xc09050), WIN_DIM = hexc(0x8a5c20), WIN_BRIGHT = hexc(0xffb050),
          BEACON0 = hexc(0x401010), BEACON1 = hexc(0xff2020), MOON = hexc(0xa89c70), RAIN_DAY0 = hexc(0x5a7aaa),
          RAIN_DAY1 = hexc(0x3a5070), RAIN_NIGHT0 = hexc(0x2c4468), RAIN_NIGHT1 = hexc(0x1e3050), SNOW0 = hexc(0x8a909c),
          SNOW1 = hexc(0xe8ecf2), SAIL = hexc(0xe8ecf0), HULL0 = hexc(0xc02828), HULL1 = hexc(0x7a1818), SPRAY = hexc(0xf4f8fc),
          GLOW = hexc(0x8a80b0), BOLT_SOFT = hexc(0xb8b0e8), STAR_BRIGHT = hexc(0xa8aebc), STAR_DIM = hexc(0x5a6070);
const char *const SEADOG[3] = {"..pqpqpqpqpqp.", "YYYYYYYYYYYYYY", ".OOOOOOOOOOOO."};
const char *const SAILS[4] = {"..#...", "..##..", "..###.", "..####"};
const int BOLT[][2] = {{21, 0}, {21, 1}, {20, 2}, {21, 3}, {22, 3}, {23, 3}, {23, 4}, {24, 5}, {23, 6}, {24, 7}, {25, 7}, {25, 8}, {25, 9}};
const int BOLT_BRANCH[][2] = {{20, 1}, {19, 2}, {18, 3}, {18, 4}, {17, 5}};
const long long RIPPLE_MS = 500, WHEEL_TURN_MS = 30000, RAIN_MS = 200;
const long long CLOUD_W = 128, CLOUD_STEP = 4000, SAIL_STEP = 800, SPEED_STEP = 150, SPEED_WAIT = 4000, QUARTER = 900000,
                STRIKE_EVERY = 30000;

static RGB seadog_color(char ch) {
  return ch == 'Y' ? hexc(0xffb020) : ch == 'p' ? hexc(0x3a5aa8) : ch == 'q' ? hexc(0xd8dce4) : hexc(0xd86a10);
}

// The payload's sky stops sampled at row y (draw.js skyAt).
static RGB sky_at(const Value &stops, int y) {
  if (y <= stops[0][0].num()) return hexs(json::str(stops[0][1]));
  for (size_t i = 1; i < stops.size(); i++) {
    if (y <= stops[i][0].num()) {
      double y0 = stops[i - 1][0].num(), y1 = stops[i][0].num();
      return mix_rgb(hexs(json::str(stops[i - 1][1])), hexs(json::str(stops[i][1])), (y - y0) / (y1 - y0));
    }
  }
  return hexs(json::str(stops[stops.size() - 1][1]));
}

template <typename L>
static void disc(Frame &f, const Geometry &G, int cx, int cy, RGB color, L lit) {
  const double c = 3.5;
  for (int y = 0; y < 7; y++)
    for (int x = 0; x < 7; x++) {
      int X = cx - 3 + x, Y = cy - 3 + y;
      if (Y < 0 || Y > SHORE || X < 0 || X >= G.W || G.isB(X, Y)) continue;
      int hit = 0;
      for (int j = 0; j < 8; j++)
        for (int i = 0; i < 8; i++) {
          double dx = x + (i + 0.5) / 8 - c, dy = y + (j + 0.5) / 8 - c;
          if (dx * dx + dy * dy <= c * c && lit(dx, dy, c)) hit++;
        }
      double k = hit / 64.0;
      if (k > 0.08) f.set(X, Y, mix_rgb(f.get(X, Y), color, k));
    }
}

}  // namespace sky

double strike_level(double ms) {
  long long slot = (long long)std::floor(ms / sky::STRIKE_EVERY);
  double start = (double)(slot * sky::STRIKE_EVERY + (long long)(ih(slot, 7, 7) % 10000));
  double t = (ms - start) / 1000;
  if (t < 0 || t >= 1.35) return 0;
  if (t < 0.15) return sstep01(0, 0.15, t);
  double u = 1 - (t - 0.15) / 1.2;
  return u * u;
}

std::optional<Boat> boat_at(double ms, int w) {
  long long m = (long long)ms;
  long long q = fdiv(m, sky::QUARTER), qi = fmod_floor(q, 4), e = m - q * sky::QUARTER;
  if (qi == 0 || qi == 2) {
    long long step = fdiv(e, sky::SAIL_STEP);
    if (step > w + 6) return std::nullopt;
    return qi == 0 ? Boat{true, (int)(w - step), -1} : Boat{true, (int)(-6 + step), 1};
  }
  long long leg = (w + 23) * sky::SPEED_STEP;
  if (e < leg) return Boat{false, (int)(w - fdiv(e, sky::SPEED_STEP)), -1};
  long long e2 = e - leg - sky::SPEED_WAIT;
  if (e2 >= 0 && e2 < leg) return Boat{false, (int)(-14 + fdiv(e2, sky::SPEED_STEP)), 1};
  return std::nullopt;
}

static void draw_boat(Frame &f, const Boat &b, int W) {
  const int S = sky::SHORE;
  if (b.sail) {
    auto put = [&](int dx, int y, RGB c) { int x = b.dir < 0 ? b.x0 + dx : b.x0 + 5 - dx; if (x >= 0 && x < W) f.fill(x, y, 1, 1, c); };
    for (int dy = 0; dy < 4; dy++)
      for (int dx = 0; sky::SAILS[dy][dx]; dx++)
        if (sky::SAILS[dy][dx] == '#') put(dx, S - 4 + dy, sky::SAIL);
    for (int dx = 0; dx < 6; dx++) put(dx, S, sky::HULL0);
    for (int dx = 1; dx < 5; dx++) put(dx, S + 1, sky::HULL1);
    return;
  }
  const int n = 14;
  auto put = [&](int dx, int y, RGB c) { int x = b.dir < 0 ? b.x0 + dx : b.x0 + n - 1 - dx; if (x >= 0 && x < W) f.fill(x, y, 1, 1, c); };
  for (int dy = 0; dy < 3; dy++)
    for (int dx = 0; sky::SEADOG[dy][dx]; dx++)
      if (sky::SEADOG[dy][dx] != '.') put(dx, S - 1 + dy, sky::seadog_color(sky::SEADOG[dy][dx]));
  const int plume[3][2] = {{S + 1, 9}, {S, 6}, {S - 1, 3}};
  for (const auto &pl : plume)
    for (int i = 0; i < pl[1]; i++) {
      int x = b.dir < 0 ? b.x0 + n + i : b.x0 - 1 - i;
      if (x >= 0 && x < W) f.set(x, pl[0], mix_rgb(f.get(x, pl[0]), sky::SPRAY, 0.95 * (1 - (double)i / pl[1])));
    }
}

static const Value &sky_none() {
  static Value v;
  static bool built = false;
  if (!built) {
    json::parse(std::string("{\"sky\":[[0,\"#000006\"],[25,\"#0c1430\"]],\"wat\":[\"#030816\",\"#02050f\",\"#0e1a36\"],\"lit\":1,\"win\":100,"
                            "\"stars\":14,\"sun\":null,\"moon\":null,\"gl\":null,\"whl\":0,\"fog\":null,\"roof\":null,\"pcp\":null,"
                            "\"storm\":0,\"boats\":0,\"temp\":null}"),
                v);
    built = true;
  }
  return v;
}

static void render_skyline(const Value &p, const Value &sky, Frame &f, std::optional<double> now_o, std::optional<double> ms_o,
                           bool blink, const Frames *clouds) {
  // The wide board's panorama: the 64 scene O px in (draw.js SKYW).
  const bool wide = cols_of(p) == WIDE;
  const sky::Geometry &G = sky::geo(wide);
  const int W = G.W, O = G.O, more = W / 64;
  f.w = W;
  // The scene's dark sky, water and night clouds would all be lifted to one
  // primary at the panel's floor (a flat blue sky, a patchwork of red and
  // blue clouds): let them go black instead (color.h).
  f.floor = false;
  const Value &s = sky.truthy() ? sky : sky_none();
  double now = now_o.has_value() ? *now_o : p["now"].num();
  double ms = ms_o.has_value() ? *ms_o : std::floor(now * 1000);
  const int S = sky::SHORE;
  double night = s["win"].num(0) / 100;

  for (int y = 0; y <= S; y++) {
    RGB c = sky::sky_at(s["sky"], y);
    for (int x = 0; x < W; x++)
      if (!G.role[y * W + x]) f.set(x, y, c);
  }
  if (s["sun"].truthy()) sky::disc(f, G, (int)s["sun"]["x"].num() + O, (int)s["sun"]["y"].num(), hexs(json::str(s["sun"]["c"])), [](double, double, double) { return true; });
  int nstars = std::min((int)s["stars"].num(0) * more, (int)G.stars.size());
  for (int i = 0; i < nstars; i++) {
    const sky::Star &st = G.stars[i];
    double k = st.tw && !(s["twk"].is_num() && s["twk"].num() == 0) ? 0.25 + 0.75 * wave(ms / st.per + st.ph / 1000.0) : 1;
    f.set(st.x, st.y, mix_rgb(f.get(st.x, st.y), st.bright ? sky::STAR_BRIGHT : sky::STAR_DIM, k));
  }
  if (s["moon"].truthy()) {
    double cosv = 1 - 2 * s["moon"]["fr"].num() / 100;
    bool waxing = s["moon"]["ph"].num() < 50;
    sky::disc(f, G, 41 + O, 5, sky::MOON, [&](double dx, double dy, double c) {
      double w = std::sqrt(std::max(0.0, c * c - dy * dy));
      return waxing ? dx > w * cosv : dx < -w * cosv;
    });
  }
  // Clouds: the server's strip, gliding left 1 px every cl.step ms (sub-pixel), behind the city.
  if (s["cl"].truthy() && clouds) {
    auto it = clouds->find(json::str(s["cl"]["id"]));
    if (it != clouds->end() && it->second.size() >= (size_t)(sky::CLOUD_W * 26 / 2)) {
      const std::vector<uint8_t> &cb = it->second;
      double step = s["cl"]["step"].is_null() ? (double)sky::CLOUD_STEP : s["cl"]["step"].num();
      double rem = step > 0 ? std::fmod(ms, step) : 0, fr = step > 0 ? rem / step : 0;
      long long off = step > 0 ? fmod_floor((long long)((ms - rem) / step), sky::CLOUD_W) : 0;
      const Value &pal = s["cl"]["pal"];
      const Value &al = s["cl"]["a"];
      RGB pc[16];
      bool has[16] = {false};
      for (size_t i = 0; i < pal.size() && i < 16; i++) {
        std::string c = json::str(pal[i]);
        if (pal[i].is_str() && !c.empty()) { pc[i] = hexs(c); has[i] = true; }
      }
      for (int y = 0; y <= S; y++)
        for (int x = 0; x < W; x++) {
          if (G.role[y * W + x]) continue;
          auto at = [&](long long col) {
            long long i = y * sky::CLOUD_W + col % sky::CLOUD_W;
            int n = (cb[i >> 1] >> ((i & 1) ? 0 : 4)) & 15;
            return n && has[n] ? n : 0;
          };
          int n0 = at(x + off), n1 = fr > 0 ? at(x + off + 1) : 0;
          if (!n0 && !n1) continue;
          RGB bg = f.get(x, y);
          RGB c0 = n0 ? mix_rgb(bg, pc[n0], al[n0].num() / 100) : bg;
          if (fr == 0) { f.set(x, y, c0); continue; }
          RGB c1 = n1 ? mix_rgb(bg, pc[n1], al[n1].num() / 100) : bg;
          f.set(x, y, mix_rgb(c0, c1, fr));
        }
    }
  }
  int lim = (int)jsround(450 * night);
  for (const sky::Win &w : G.wins)
    if ((int)w.th < lim) f.fill(w.x, w.y, 1, 1, w.bright ? sky::WIN_BRIGHT : sky::WIN_DIM);
  if (s["roof"].truthy()) {
    RGB rc = hexs(json::str(s["roof"]));
    for (int x = 0; x < W; x++)
      for (int y = 0; y <= S; y++)
        if (G.role[y * W + x]) { f.fill(x, y, 1, 1, rc); break; }
  }
  if (s["fog"].truthy()) {
    RGB fc = hexs(json::str(s["fog"]));
    for (int y = 0; y <= S; y++) {
      double k = std::max(0.0, std::min(1.0, (21 - y) / 18.0)) * 0.85;
      if (k)
        for (int x = 0; x < W; x++) f.set(x, y, mix_rgb(f.get(x, y), fc, k));
    }
  }
  double lv = s["storm"].truthy() ? strike_level(ms) : 0;
  if (lv > 0) {
    for (int y = 0; y <= S; y++)
      for (int x = 0; x < W; x++) {
        if (G.role[y * W + x]) continue;
        double ex = (x + 0.5 - 22 - O) / 11, ey = (y + 0.5 - 4) / 4, d = std::sqrt(ex * ex + ey * ey);
        double a = lv * (0.35 + 0.45 * (1 - sstep01(0.3, 1, d)));  // whole sky 35%, the patch 80%
        if (a > 0.01) f.set(x, y, mix_rgb(f.get(x, y), sky::GLOW, a));
      }
    auto put = [&](int x, int y, RGB c) {
      if (x >= 0 && x < W && y >= 0 && !G.role[y * W + x]) f.set(x, y, mix_rgb(f.get(x, y), mix_rgb(c, sky::BOLT_SOFT, 0.15), 0.8 * lv));
    };
    auto in_core = [](int x, int y) { for (const auto &b : sky::BOLT) if (b[0] == x && b[1] == y) return true; return false; };
    for (const auto &b : sky::BOLT)
      for (int X : {b[0] - 1, b[0] + 1})
        if (!in_core(X, b[1])) put(X + O, b[1], hexc(0x7060c0));
    for (const auto &b : sky::BOLT_BRANCH) put(b[0] + O, b[1], hexc(0x9a8ae0));
    for (const auto &b : sky::BOLT) put(b[0] + O, b[1], hexc(0xffffff));
  }
  RGB beacon = mix_rgb(sky::BEACON0, sky::BEACON1, wave(ms / 4000));
  for (const sky::Ant &a : G.ants) {
    f.fill(a.x, a.t, 1, a.roof - a.t, hexc(0x000000));
    if (a.beacon && s["lit"].truthy()) f.fill(a.x, a.t, 1, 1, beacon);
  }
  bool lit = s["lit"].truthy();
  int whl = clampi((int)s["whl"].num(0), 0, 2);
  RGB leg = lit ? sky::WHEEL_NIGHT : sky::WHEEL_LEG[whl];
  for (const auto &l : G.legs) f.fill(l.first, l.second, 1, 1, leg);
  f.fill(G.bar[0], G.bar[1], G.bar[2], 1, leg);
  double turn_ms = s["wheel"].is_num() ? s["wheel"].num() : (double)sky::WHEEL_TURN_MS;  // 0: still
  double turn = turn_ms > 0 ? std::fmod(ms, turn_ms) * (360.0 / turn_ms) : 0;
  for (const sky::RimPx &r : G.rim) f.fill(r.x, r.y, 1, 1, lit ? hsv_rgb(std::fmod(r.deg + turn, 360.0), 0.7, 0.9) : sky::WHEEL_RIM[whl]);
  f.fill(G.CX - 1, sky::CY - 1, 2, 2, leg);

  ustr clock = clock_text(now, p["tzo"].num());
  int cw = measure(FONT_SMALL, clock);
  const Value &warn = p["warn"];
  bool has_warn = warn.truthy();
  WarnStyle ws;
  if (has_warn) ws = warn_style(warn);
  ustr wword = has_warn ? (warn["lvl"].eq("warning") ? U"WARNING" : U"WATCH") : U"";
  ustr temp_str = s["temp"].is_null() ? U"" : vstr(s["temp"]) + U"°";
  int lw = has_warn ? measure(FONT_SMALL, ws.glyph) + TAG_GAP - 1 + measure(FONT_SMALL, wword) : !temp_str.empty() ? measure(FONT_SMALL, temp_str) : 0;
  auto quiet = [&](int x, int y) { return y >= S + 2 && ((lw && x <= lw) || x >= W - 1 - cw); };

  double rip_ms = s["rip"].is_num() ? s["rip"].num() : (double)sky::RIPPLE_MS;  // ripples: 1 px every rip_ms, sub-pixel; 0: still
  double glide = rip_ms > 0 ? std::fmod(ms, rip_ms * 990) / rip_ms : 0;
  RGB ripple = hexs(json::str(s["wat"][2]));
  const Value &gl = s["gl"];
  bool path = gl.truthy() && gl["p"].num() > 0;
  RGB path_rgb = path ? mix_rgb(ripple, hexs(json::str(gl["c"])), gl["p"].num() / 100) : RGB{};
  for (int y = S + 1; y < 32; y++) {
    f.fill(0, y, W, 1, mix_rgb(hexs(json::str(s["wat"][0])), hexs(json::str(s["wat"][1])), (double)(y - S - 1) / (32 - S - 2)));
    int dir = y % 2 ? 1 : -1, len = y - S <= 2 ? 2 : 3, gap = 9 + (y % 3);
    for (int x = 0; x < W; x++) {
      if (quiet(x, y)) continue;
      double u = x - dir * glide + y * 5, a = u - gap * std::floor(u / gap);
      double cov = std::max(0.0, std::min(a + 1, (double)len) - a) + std::max(0.0, a + 1 - gap);
      if (cov <= 0) continue;
      bool on_path = path && std::abs(x + 0.5 - O - gl["x"].num()) < 1.5 + (y - S) * 0.8;
      f.set(x, y, mix_rgb(f.get(x, y), on_path ? path_rgb : ripple, std::min(1.0, cov)));
    }
  }
  f.fill(24 + O, S, 16, 1, s["roof"].truthy() ? hexs(json::str(s["roof"])) : mix_rgb(sky::PIER_DAY0, sky::PIER_NIGHT0, night));
  f.fill(24 + O, S + 1, 16, 1, mix_rgb(sky::PIER_DAY1, sky::PIER_NIGHT1, night));
  if (lit)
    for (int x = 24 + O; x <= 39 + O; x += 3) f.fill(x, S, 1, 1, sky::PIER_BULB);
  if (s["boats"].truthy()) {
    std::optional<Boat> b = boat_at(ms, W);
    if (b) draw_boat(f, *b, W);
  }
  const Value &pcp = s["pcp"];
  if (pcp.truthy() && pcp["n"].num() > 0) {
    int n = (int)pcp["n"].num() * more;
    double fall = s["fall"].num(0) > 0 ? s["fall"].num() : (double)sky::RAIN_MS;
    if (pcp["k"].eq("r")) {
      RGB c1 = mix_rgb(sky::RAIN_DAY0, sky::RAIN_NIGHT0, night), c2 = mix_rgb(sky::RAIN_DAY1, sky::RAIN_NIGHT1, night);
      int sl = (int)pcp["sl"].num(0);
      double rem = std::fmod(ms, fall), fr = rem / fall;
      long long step = (long long)((ms - rem) / fall);
      for (int i = 0; i < n; i++) {
        int land = S + 1 + (int)(ih(i, 33, 4) % (31 - S)), cyc = land + 1;  // falls to its own row of water
        int hy = (int)((ih(i, 32, 4) % cyc + step) % cyc);
        int hx = (int)fmod_floor((long long)(ih(i, 31, 4) % W) + sl * (step % W), W);
        for (int j = -1; j <= 1; j++) {
          int y = hy + j;
          double d = fr - j;
          if (y < 0 || y > land) continue;
          int x = (int)fmod_floor((long long)(hx + sl * j), W);
          if (quiet(x, y)) continue;
          RGB c = d <= 0 ? c1 : d <= 1 ? mix_rgb(c1, c2, d) : c2;
          double a = d <= 0 ? 1 + d : d <= 1 ? 1 : 2 - d;
          if (a > 0) f.set(x, y, mix_rgb(f.get(x, y), c, a));
        }
      }
    } else {
      long long step = (long long)std::floor(ms / (fall * 3.5));
      for (int i = 0; i < n; i++) {
        int cyc = S + 2 + (int)(ih(i, 25, 4) % (31 - S));
        int y = (int)((ih(i, 22, 4) % cyc + step) % cyc);
        long long side = fmod_floor(fdiv((long long)ms + (long long)(ih(i, 23, 4) % 2000), 2000), 2);
        int x = (int)((ih(i, 21, 4) % W + side) % W);
        if (quiet(x, y)) continue;
        f.fill(x, y, 1, 1, ih(i, 24, 4) % 10 < 4 ? sky::SNOW1 : sky::SNOW0);
      }
    }
  }
  if (has_warn) {
    if (!(ws.blinks && blink)) f.text(FONT_SMALL, wword, f.text(FONT_SMALL, ws.glyph, 0, 32, ws.color) + TAG_GAP - 1, 32, ws.color);
  } else if (!temp_str.empty()) {
    f.text(FONT_SMALL, temp_str, 0, 32, C::label);
  }
  f.text(FONT_SMALL, clock, W - cw, 32, C::label);
}

// ---- clock screen: seventies face (design spec §16; contract "Seventies") ----
// Mirrors renderSeventies() and S70 in draw.js.
static const RGB S70_COLORS[] = {hexc(0xffc23a), hexc(0xff7414), hexc(0xd2361a)};
static const int S70_TOP = 5, S70_BASE = 16, S70_RIGHT = 52, S70_CX = 54, S70_CY = 21, S70_RADII[] = {3, 6, 9};

static void render_seventies_wide(const Value &p, Frame &f, double now);
static void render_seventies(const Value &p, Frame &f, std::optional<double> now_o) {
  double now = now_o ? *now_o : p["now"].num(0);
  if (cols_of(p) == WIDE) return render_seventies_wide(p, f, now);
  for (int i = 0; i < 3; i++) {
    int r = S70_RADII[i];
    RGB c = S70_COLORS[i];
    f.fill(0, S70_CY + r - 1, S70_CX, 2, c);
    f.fill(S70_CX + r - 1, 0, 2, S70_CY, c);
    int lo = (2 * r - 2) * (2 * r - 2), hi = (2 * r + 2) * (2 * r + 2);
    for (int y = S70_CY; y < 32; y++)
      for (int x = S70_CX; x < 64; x++) {
        int u = 2 * (x - S70_CX) + 1, v = 2 * (y - S70_CY) + 1, d = u * u + v * v;
        if (d > lo && d <= hi) f.fill(x, y, 1, 1, c);
      }
  }
  // Centered in columns 0-52, drawn white, then banded by row.
  roll_named(f, FONT_VCR, "svt.clock", clock_text(now, p["tzo"].num(0)), SPAN, S70_RIGHT, S70_BASE, hexc(0xffffff));
  for (int y = S70_TOP; y < S70_BASE; y++) {
    RGB band = S70_COLORS[y < S70_TOP + 4 ? 0 : y < S70_TOP + 7 ? 1 : 2];
    for (int xx = 0; xx <= S70_RIGHT; xx++) {
      RGB c = f.get(xx, y);
      if (c.r || c.g || c.b) f.set(xx, y, band);
    }
  }
}

// ---- clock faces: shared date and integer trig (draw.js localDate, sinD) ----
static const char *const DAY_NAMES[] = {"SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"};
static const char *const MONTH_NAMES[] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};
struct LocalDate {
  long long wd, m, d, h, min, s;
};
static LocalDate local_date(double now, double tzo);
static ustr wide_date_line(double now, double tzo) {
  LocalDate t = local_date(now, tzo);
  return U(std::string(DAY_NAMES[t.wd]).substr(0, 3) + " " + MONTH_NAMES[t.m - 1] + " " + std::to_string(t.d));
}
static LocalDate local_date(double now, double tzo) {
  long long lt = (long long)floor(now + tzo), days = fdiv(lt, 86400);
  LocalDate r;
  r.wd = fmod_floor(days + 4, 7);
  long long z = days + 719468, era = fdiv(z, 146097), doe = z - era * 146097;
  long long yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36524) - fdiv(doe, 146096), 365);
  long long doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100)), mp = fdiv(5 * doy + 2, 153);
  r.d = doy - fdiv(153 * mp + 2, 5) + 1;
  r.m = mp < 10 ? mp + 3 : mp - 9;
  long long sec = lt - days * 86400;
  r.h = fdiv(sec, 3600);
  r.min = fdiv(sec, 60) % 60;
  r.s = sec % 60;
  return r;
}
static const int SIN1E4[] = {0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756, 2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431, 7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000};
static long long sin_d(long long deg) {
  long long d = fmod_floor(deg, 360);
  return d <= 90 ? SIN1E4[d] : d <= 180 ? SIN1E4[180 - d] : d <= 270 ? -SIN1E4[d - 180] : -SIN1E4[360 - d];
}
static long long cos_d(long long deg) { return sin_d(deg + 90); }

// ---- clock screen: analog face (design spec §17; contract "Analog") ----
// Mirrors renderAnalog() and AN in draw.js.
static const int AN_CX = 15, AN_CY = 15, AN_RX = 48;
static const int8_t AN_HOUR[] = {15,8,16,8,16,8,17,8,18,9,19,9,19,9,20,10,20,10,21,11,21,12,21,12,22,13,22,14,22,14,22,15,22,16,22,16,22,17,21,18,21,19,21,19,20,20,20,20,19,21,19,21,18,21,17,22,16,22,16,22,15,22,14,22,14,22,13,22,12,21,12,21,11,21,10,20,10,20,9,19,9,19,9,18,8,17,8,16,8,16,8,15,8,14,8,14,8,13,9,12,9,12,9,11,10,10,10,10,11,9,11,9,12,9,13,8,14,8,14,8};
static const int8_t AN_MIN[] = {15,4,16,4,17,4,18,5,19,5,21,5,21,6,22,7,23,8,24,9,25,10,25,11,25,12,26,13,26,14,26,15,26,16,26,17,25,18,25,19,25,20,24,21,23,22,22,23,21,24,21,25,19,25,18,25,17,26,16,26,15,26,14,26,13,26,12,25,11,25,10,25,9,24,8,23,7,22,6,21,5,21,5,19,5,18,4,17,4,16,4,15,4,14,4,13,5,12,5,11,5,10,6,9,7,8,8,7,9,6,9,5,11,5,12,5,13,4,14,4};
static const int8_t AN_SEC[] = {15,2,16,2,18,2,19,3,20,3,22,4,23,4,24,5,25,6,26,7,26,8,27,10,27,11,28,12,28,14,28,15,28,16,28,18,27,19,27,20,26,21,26,23,25,24,24,25,23,26,22,26,20,27,19,27,18,28,16,28,15,28,14,28,12,28,11,27,10,27,8,26,7,26,6,25,5,24,4,23,4,22,3,20,3,19,2,18,2,16,2,15,2,14,2,12,3,11,3,10,4,8,4,7,5,6,6,5,7,4,8,4,10,3,11,3,12,2,14,2};
static const int8_t AN_TICKS[] = {15,2,1,15,3,1,22,4,0,26,8,0,28,15,1,27,15,1,26,21,0,22,26,0,15,28,1,15,27,1,8,26,0,4,22,0,2,15,1,3,15,1,4,8,0,8,4,0};

static void bresenham(Frame &f, int x0, int y0, int x1, int y1, RGB c) {
  int dx = std::abs(x1 - x0), dy = -std::abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;
  for (;;) {
    f.fill(x0, y0, 1, 1, c);
    if (x0 == x1 && y0 == y1) break;
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
static void midpoint_circle(Frame &f, int cx, int cy, int r, RGB c) {
  int x = r, y = 0, err = 1 - r;
  while (x >= y) {
    const int pts[8][2] = {{x, y}, {y, x}, {-y, x}, {-x, y}, {-x, -y}, {-y, -x}, {y, -x}, {x, -y}};
    for (auto &q : pts) f.fill(cx + q[0], cy + q[1], 1, 1, c);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}
// Wide board (draw.js drawCalendar; wide-spec §6): this month in seven
// 13 px columns from x37, five week rows (a sixth week wraps to the first
// row), today white on the accent at 40%.
static const int CAL_X0 = 37, CAL_COL_W = 13;
static const RGB CAL_DAY = hexc(0xb8b8b8), CAL_WEEKEND = hexc(0x6a6a6a);
static const int MONTH_DAYS[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
static void draw_calendar(Frame &f, double now, double tzo, RGB accent) {
  LocalDate t = local_date(now, tzo);
  double first = now - (double)(t.d - 1) * 86400;
  long long n = t.m == 2 ? (local_date(first + 28 * 86400, tzo).m == 2 ? 29 : 28) : MONTH_DAYS[t.m - 1];
  long long off = fmod_floor(t.wd - (t.d - 1), 7);
  for (long long d = 1; d <= n; d++) {
    long long i = off + d - 1, col = i % 7, row = fdiv(i, 7) % 5;
    int cx = CAL_X0 + (int)col * CAL_COL_W + 6, base = 6 + (int)row * 6;
    ustr str = num_text(d);
    if (d == t.d) f.fill(cx - 5, base - 6, 11, 7, scale_color(accent, 0.4));
    f.text(FONT_SMALL, str, cx - (int)fdiv(measure(FONT_SMALL, str) - 1, 2), base, d == t.d ? C::white : col == 0 || col == 6 ? CAL_WEEKEND : CAL_DAY);
  }
}
static void render_analog(const Value &p, Frame &f, std::optional<double> now_o) {
  double now = now_o ? *now_o : p["now"].num(0);
  bool wide = cols_of(p) == WIDE;
  if (wide) f.w = WIDE;
  LocalDate t = local_date(now, p["tzo"].num(0));
  midpoint_circle(f, AN_CX, AN_CY, 15, hexc(0x333333));
  for (size_t i = 0; i < sizeof AN_TICKS; i += 3) f.fill(AN_TICKS[i], AN_TICKS[i + 1], 1, 1, AN_TICKS[i + 2] ? C::wxText : C::dimHead);
  auto hand = [&](const int8_t *tab, long long i, RGB c) { bresenham(f, AN_CX, AN_CY, tab[i * 2], tab[i * 2 + 1], c); };
  hand(AN_HOUR, (t.h % 12) * 5 + fdiv(t.min, 12), C::clock);
  hand(AN_MIN, t.min, C::clock);
  RGB accent = p["cacc"].truthy() ? hexs(p["cacc"].str_or("")) : C::amber;
  hand(AN_SEC, t.s, accent);
  f.fill(AN_CX, AN_CY, 1, 1, C::clock);
  if (wide) return draw_calendar(f, now, p["tzo"].num(0), accent);
  ustr full = U(DAY_NAMES[t.wd]);
  ustr day = measure(FONT_SMALL, full) <= 31 ? full : full.substr(0, 3);
  f.text(FONT_SMALL, day, AN_RX - (int)fdiv(measure(FONT_SMALL, day), 2), 7, C::wxText);
  ustr date = U(std::string(MONTH_NAMES[t.m - 1]) + " " + std::to_string(t.d));
  f.text(FONT_5X7, date, AN_RX - (int)fdiv(measure(FONT_5X7, date), 2), 17, C::label);
  const Value &w = p["cwx"];
  if (w.truthy() && !w["temp"].is_null()) {
    ustr temp = vstr(w["temp"]);
    int tw = measure(FONT_5X7, temp) + 3, x0 = AN_RX - (int)fdiv(8 + 2 + tw, 2);
    int icon = icon_index(w["icon"]);
    if (icon >= 0) draw_icon(f, icon, x0, 22);
    int x = f.text(FONT_5X7, temp, x0 + 10, 30, C::label);
    f.text(FONT_SMALL, U"°", x, 28, C::label);
  }
}

// ---- clock screen: word clock (wide boards only; draw.js renderWords) ----
static const char *const WORDS_ROWS[] = {"IT IS HALF TEN QUARTER TWENTY", "FIVE MINUTES TO PAST ONE TWO", "THREE FOUR FIVE SIX SEVEN EIGHT",
                                         "NINE TEN ELEVEN TWELVE O'CLOCK", "IN THE MORNING AFTERNOON EVENING"};
static const RGB WORDS_OFF = hexc(0x2a2a2a);
// Word ids: row * 8 + the word's place in its row (draw.js WORDS).
static const int WORDS_HOURS[] = {27, 12, 13, 16, 17, 18, 19, 20, 21, 24, 25, 26};
static const int WORDS_MINS[12][5] = {{28, -1}, {8, 9, 11, -1}, {3, 9, 11, -1}, {4, 11, -1}, {5, 9, 11, -1}, {5, 8, 9, 11, -1},
                                      {2, 11, -1}, {5, 8, 9, 10, -1}, {5, 9, 10, -1}, {4, 10, -1}, {3, 9, 10, -1}, {8, 9, 10, -1}};
static void render_words(const Value &p, Frame &f, std::optional<double> now_o) {
  f.w = WIDE;
  double now = now_o ? *now_o : p["now"].num(0);
  LocalDate t = local_date(now, p["tzo"].num(0));
  long long q = fdiv(t.min + 2, 5), h = t.h;
  if (q == 12) {
    q = 0;
    h = (h + 1) % 24;
  }
  if (q >= 7) h = (h + 1) % 24;
  std::vector<int> lit = {0, 1, WORDS_HOURS[h % 12], 32, 33, h < 12 ? 34 : h < 18 ? 35 : 36};
  for (int i = 0; WORDS_MINS[q][i] >= 0; i++) lit.push_back(WORDS_MINS[q][i]);
  for (int j = 0; j < 5; j++) {
    std::string row = WORDS_ROWS[j];
    int x0 = (int)fdiv(WIDE - measure(FONT_SMALL, U(row)), 2);
    std::string prefix;
    size_t start = 0;
    for (int k = 0; start <= row.size(); k++) {
      size_t end = row.find(' ', start);
      if (end == std::string::npos) end = row.size();
      std::string word = row.substr(start, end - start);
      bool on = std::find(lit.begin(), lit.end(), j * 8 + k) != lit.end();
      f.text(FONT_SMALL, U(word), x0 + (prefix.empty() ? 0 : measure(FONT_SMALL, U(prefix)) + 1), 6 + j * 6, on ? C::amber : WORDS_OFF);
      prefix += word + " ";
      start = end + 1;
    }
  }
}

// ---- clock screen: day/night map face (design spec §18; contract "Day/night") ----
// Mirrors renderDayNight() and DN in draw.js.
static const int DN_ROWS = 26;
static const long long DN_NIGHT12 = -2079LL * 10000;
static const RGB DN_SEA = hexc(0x2c70b0), DN_NIGHT_SEA = hexc(0x143a5c), DN_HERE = hexc(0xffffff);
static const int DN_NIGHT_K[] = {104, 116, 140};
static RGB world_color(const assets::IconColor *pal, int n, char code) {
  for (int i = 0; i < n; i++)
    if (pal[i].code == code) return RGB{pal[i].r, pal[i].g, pal[i].b};
  return RGB{};
}
static uint8_t mix_int(uint8_t n, uint8_t d, long long k) { return (uint8_t)(n + fdiv(((long long)d - n) * k, 256)); }

// The map lit by the sun (draw.js drawWorld): `rows` x `cols` pixels of
// `deg` degrees from `top` degrees north and 180 W.
static void draw_world(Frame &f, const Value &dn, long long now, const char *const *world, const assets::IconColor *pal,
                       int pal_n, int rows, int cols, double top, double deg) {
  // The subsolar longitude moves 15° an hour: tenths of a degree back from dn.t.
  long long lon10 = (long long)dn["lon"].num(0) - fdiv(now - (long long)dn["t"].num(0), 24);
  lon10 = fmod_floor(lon10 + 1800, 3600) - 1800;
  long long dec10 = (long long)dn["dec"].num(0);
  long long dec_d = fdiv(dec10 + 5, 10), lon_d = fdiv(lon10 + 5, 10);
  long long s_dec = sin_d(dec_d), c_dec = cos_d(dec_d);
  for (int y = 0; y < rows; y++) {
    long long lat = (long long)jsround(top - (y + 0.5) * deg);
    long long sl = sin_d(lat) * s_dec, cl = cos_d(lat) * c_dec;
    for (int x = 0; x < cols; x++) {
      long long lon = (long long)jsround(-180 + (x + 0.5) * deg);
      // sin(sun's altitude) x 1e8.
      long long sv = sl + fdiv(cl * cos_d(lon - lon_d), 10000);
      long long k = sv >= 0 ? 256 : sv <= DN_NIGHT12 ? 0 : 256 - fdiv(sv * 256, DN_NIGHT12);
      char code = world[y][x];
      RGB d, n;
      if (code == '.') {
        d = DN_SEA;
        n = DN_NIGHT_SEA;
      } else {
        d = world_color(pal, pal_n, code);
        n = RGB{(uint8_t)fdiv(d.r * DN_NIGHT_K[0], 256), (uint8_t)fdiv(d.g * DN_NIGHT_K[1], 256), (uint8_t)fdiv(d.b * DN_NIGHT_K[2], 256)};
      }
      f.set(x, y, RGB{mix_int(n.r, d.r, k), mix_int(n.g, d.g, k), mix_int(n.b, d.b, k)});
    }
  }
}

// Wide board (draw.js renderDayNightWide; wide-spec §6): the 80 x 32 map at
// 4.5°, the board's spot dn.hw; the sun panel from column 83.
static const int DNW_X0 = 83;
static const RGB DNW_RISE = hexc(0xffc23a), DNW_SET = hexc(0xff7414), DNW_DIVIDER = hexc(0x262626);
static const char *const SUN_ICON[] = {"...#...", ".#...#.", "..###..", "#.###.#", "-------"};
static void render_daynight_wide(const Value &p, Frame &f, long long now) {
  f.w = WIDE;
  const Value &dn = p["dn"];
  double tzo = p["tzo"].num(0);
  if (dn.truthy()) {
    draw_world(f, dn, now, assets::WORLD_WIDE, assets::WORLD_WIDE_PALETTE, assets::WORLD_WIDE_PALETTE_N, assets::WORLD_WIDE_H,
               assets::WORLD_WIDE_W, 84, 4.5);
    const Value &hw = dn["hw"];
    if (hw.is_arr() && hw.size() == 2 && hw[1].num(0) < 32) f.fill((int)hw[0].num(0), (int)hw[1].num(0), 1, 1, DN_HERE);
  }
  LocalDate t = local_date((double)now, tzo);
  int x = roll_named(f, FONT_5X7, "dn.clock", clock_text((double)now, tzo), LEFT, DNW_X0, 8, hexc(0xffffff));
  f.text(FONT_SMALL, t.h < 12 ? U"AM" : U"PM", x + 1, 8, C::wxText);
  f.fill(DNW_X0, 11, WIDE - DNW_X0, 1, DNW_DIVIDER);
  if (dn.truthy() && !dn["sr"].is_null() && !dn["ss"].is_null()) {
    long long sr = (long long)dn["sr"].num(0), ss = (long long)dn["ss"].num(0);
    const long long times[] = {sr, ss};
    const uint32_t arrows[] = {assets::G_UP, assets::G_DOWN};
    const RGB colors[] = {DNW_RISE, DNW_SET};
    for (int i = 0; i < 2; i++) {
      int base = 18 + i * 7;
      RGB c = colors[i];
      for (int j = 0; j < 5; j++)
        for (int k = 0; SUN_ICON[j][k]; k++)
          if (SUN_ICON[j][k] != '.') f.fill(DNW_X0 + k, base - 5 + j, 1, 1, SUN_ICON[j][k] == '#' ? c : C::dimHead);
      f.text(FONT_SMALL, g(arrows[i]), DNW_X0 + 9, base, c);
      LocalDate d = local_date((double)times[i], tzo);
      rtext(f, FONT_SMALL, clock_text((double)times[i], tzo) + (d.h < 12 ? U" AM" : U" PM"), WIDE - 1, base, c);
    }
    long long mins = std::max(0LL, fdiv(ss - sr, 60));
    f.text(FONT_SMALL, U"DAY", DNW_X0, 32, C::dimHead);
    rtext(f, FONT_SMALL, num_text(fdiv(mins, 60)) + U"h " + num_text(mins % 60) + U"m", WIDE - 1, 32, C::wxText);
  }
}

static void render_daynight(const Value &p, Frame &f, std::optional<double> now_o) {
  long long now = (long long)floor(now_o ? *now_o : p["now"].num(0));
  if (cols_of(p) == WIDE) return render_daynight_wide(p, f, now);
  const Value &dn = p["dn"];
  if (dn.truthy()) {
    draw_world(f, dn, now, assets::WORLD, assets::WORLD_PALETTE, assets::WORLD_PALETTE_N, DN_ROWS, 64, 84.375, 5.625);
    const Value &here = dn["here"];
    if (here.is_arr() && here.size() == 2 && here[1].num(0) < DN_ROWS) f.fill((int)here[0].num(0), (int)here[1].num(0), 1, 1, DN_HERE);
  }
  LocalDate t = local_date((double)now, p["tzo"].num(0));
  int x = roll_named(f, FONT_SMALL, "dn.clock", clock_text((double)now, p["tzo"].num(0)), LEFT, 0, 32, C::label);
  f.text(FONT_SMALL, t.h < 12 ? U"AM" : U"PM", x + 2, 32, C::wxText);
  ustr date = U(std::string(DAY_NAMES[t.wd]).substr(0, 3) + " " + MONTH_NAMES[t.m - 1] + " " + std::to_string(t.d));
  f.text(FONT_SMALL, date, 64 - measure(FONT_SMALL, date), 32, C::wxText);
}

// ---- clock screen: seventies face, wide board (draw.js renderSeventiesWide; wide-spec §6) ----
// The stripes along the bottom, up columns 62-69 and along the top; the time
// on the left; the weekday in full, the date and the temperature (cwx).
static const int S70W_CX1 = 60, S70W_CY1 = 21, S70W_CX2 = 72, S70W_CY2 = 10, S70W_TEXT_X = 78;
static bool s70_ring(int u, int v, int r) {
  int d = u * u + v * v;
  return d > (2 * r - 2) * (2 * r - 2) && d <= (2 * r + 2) * (2 * r + 2);
}
static void render_seventies_wide(const Value &p, Frame &f, double now) {
  f.w = WIDE;
  for (int i = 0; i < 3; i++) {
    int r = S70_RADII[i], r2 = 12 - r;
    RGB c = S70_COLORS[i];
    f.fill(0, S70W_CY1 + r - 1, S70W_CX1, 2, c);
    f.fill(S70W_CX1 + r - 1, S70W_CY2, 2, S70W_CY1 - S70W_CY2 + 1, c);
    f.fill(S70W_CX2, S70W_CY2 - r2 - 1, WIDE - S70W_CX2, 2, c);
    for (int y = S70W_CY1 + 1; y < 32; y++)
      for (int x = S70W_CX1; x < WIDE; x++)
        if (s70_ring(2 * (x - S70W_CX1) + 1, 2 * (y - S70W_CY1) + 1, r)) f.fill(x, y, 1, 1, c);
    for (int y = 0; y < S70W_CY2; y++)
      for (int x = 0; x < S70W_CX2; x++)
        if (s70_ring(2 * (x - S70W_CX2) + 1, 2 * (y - S70W_CY2) + 1, r2)) f.fill(x, y, 1, 1, c);
  }
  // Centered in columns 0-57, drawn white, then banded by row.
  roll_named(f, FONT_VCR, "svt.clock", clock_text(now, p["tzo"].num(0)), SPAN, S70W_CX1 - 3, S70_BASE, hexc(0xffffff));
  for (int y = S70_TOP; y < S70_BASE; y++) {
    RGB band = S70_COLORS[y < S70_TOP + 4 ? 0 : y < S70_TOP + 7 ? 1 : 2];
    for (int xx = 0; xx < S70W_CX1 - 1; xx++) {
      RGB c = f.get(xx, y);
      if (c.r || c.g || c.b) f.set(xx, y, band);
    }
  }
  LocalDate t = local_date(now, p["tzo"].num(0));
  ustr day = U(DAY_NAMES[t.wd]);
  f.text(FONT_5X7, day, std::min(S70W_TEXT_X, WIDE - measure(FONT_5X7, day)), 20, S70_COLORS[0]);
  f.text(FONT_5X7, U(std::string(MONTH_NAMES[t.m - 1]) + " " + std::to_string(t.d)), S70W_TEXT_X, 29, S70_COLORS[1]);
  const Value &w = p["cwx"];
  if (w.truthy() && !w["temp"].is_null()) rtext(f, FONT_5X7, vstr(w["temp"]) + U"°", WIDE - 1, 29, S70_COLORS[2]);
}

// ---- clock screen: gradient face (design spec §19; contract "Gradient") ----
// Mirrors renderGradient() and GR in draw.js.
static const RGB GR_RING[] = {hexc(0xffc24a), hexc(0xff8a52), hexc(0xff5f7e), hexc(0xe94fb8), hexc(0xa55cff),
                              hexc(0x5a5cf2), hexc(0x3e9cff), hexc(0x3fd6c6), hexc(0x9be65a), hexc(0xffe14a)};
static const long long GR_N = 10, GR_SPAN = 3, GR_STEP = 360000;
// Digit geometry by width (draw.js BIG): blocks sx x sy, the gap, and the
// colon's width, lead and gap after.
struct BigGeo {
  int w, sx, sy, gap, colon_w, lead, colon_gap;
};
static const BigGeo BIG64 = {64, 4, 6, 4, 4, -2, 2}, BIG128 = {128, 7, 6, 5, 4, 0, 5};

static RGB gradient_color(int x, int y, long long ms, int w = 64) {
  long long u = fdiv((long long)(x * 2 + y * 3) * 1024, (w - 1) * 2 + 31 * 3 + 1);
  long long r = fdiv(ms * 256, GR_STEP) + fdiv(u * GR_SPAN * 256, 1024);
  long long i = fmod_floor(fdiv(r, 256), GR_N), t = fmod_floor(r, 256);
  RGB a = GR_RING[i], b = GR_RING[(i + 1) % GR_N];
  return RGB{mix_int(a.r, b.r, t), mix_int(a.g, b.g, t), mix_int(a.b, b.b, t)};
}

// Giant block digits (draw.js GR_GLYPHS, bigW / bigChar / bigText): 3 x 5
// digits, index 10 the 1 x 5 colon.
static const char *const GR_GLYPHS[11][5] = {
    {"###", "#.#", "#.#", "#.#", "###"}, {"##.", ".#.", ".#.", ".#.", "###"}, {"###", "..#", "###", "#..", "###"},
    {"###", "..#", "###", "..#", "###"}, {"#.#", "#.#", "###", "..#", "..#"}, {"###", "#..", "###", "..#", "###"},
    {"###", "#..", "###", "#.#", "###"}, {"###", "..#", "..#", "..#", "..#"}, {"###", "#.#", "###", "#.#", "###"},
    {"###", "#.#", "###", "..#", "###"}, {".", "#", ".", "#", "."}};
static int gr_index(char32_t ch) { return ch == U':' ? 10 : ch >= U'0' && ch <= U'9' ? (int)(ch - U'0') : -1; }
static int big_lead(const BigGeo &g, char32_t ch) { return ch == U':' ? g.lead : 0; }
static int big_gap(const BigGeo &g, char32_t ch) { return ch == U':' ? g.colon_gap : g.gap; }
static int big_block_w(const BigGeo &g, char32_t ch) { return ch == U':' ? g.colon_w : g.sx; }
static int big_w(const BigGeo &g, const ustr &s) {
  int w = -g.gap;
  for (char32_t ch : s) {
    int gi = gr_index(ch);
    if (gi >= 0) w += big_lead(g, ch) + (int)strlen(GR_GLYPHS[gi][0]) * big_block_w(g, ch) + big_gap(g, ch);
  }
  return w;
}
static int big_char(Frame &f, const BigGeo &g, char32_t ch, int x, int top, RGB c) {
  int gi = gr_index(ch);
  if (gi < 0) return x;
  x += big_lead(g, ch);
  int w = (int)strlen(GR_GLYPHS[gi][0]), bw = big_block_w(g, ch);
  for (int r = 0; r < 5; r++)
    for (int i = 0; i < w; i++)
      if (GR_GLYPHS[gi][r][i] == '#') f.fill(x + i * bw, top + r * g.sy, bw, g.sy, c);
  return x + w * bw + big_gap(g, ch);
}
static void big_text(Frame &f, const BigGeo &g, const ustr &s, int x, int top, RGB c) {
  for (char32_t ch : s) x = big_char(f, g, ch, x, top, c);
}

// The time, rolling at the minute (draw.js drawBigTime / bigRoll).
static void draw_big_time(Frame &f, const BigGeo &g, const Value &p, double now, RGB color) {
  ustr text = clock_text(now, p["tzo"].num(0));
  const int H = 5 * g.sy, top = (int)fdiv(32 - H, 2);
  auto x_of = [&g](const ustr &s) { return (int)fdiv(g.w - big_w(g, s), 2); };
  std::optional<Roll> roll = take_roll("grad.clock", text);
  if (!roll) {
    big_text(f, g, text, x_of(text), top, color);
    return;
  }
  int dist = H + g.sy, up = (int)jsround(ease_in_out(roll->p) * dist);
  const ustr &from = roll->from;
  f.push_clip(0, top, g.w - 1, top + H - 1);
  bool same = x_of(from) == x_of(text) && from.size() == text.size();
  for (size_t i = 0; same && i < text.size(); i++) same = big_w(g, text.substr(i, 1)) == big_w(g, from.substr(i, 1));
  if (same) {
    int x = x_of(text);
    for (size_t i = 0; i < text.size(); i++) {
      if (text[i] == from[i]) big_char(f, g, text[i], x, top, color);
      else {
        big_char(f, g, from[i], x, top - up, color);
        big_char(f, g, text[i], x, top - up + dist, color);
      }
      x += big_w(g, text.substr(i, 1)) + g.gap;
    }
  } else {
    big_text(f, g, from, x_of(from), top - up, color);
    big_text(f, g, text, x_of(text), top - up + dist, color);
  }
  f.pop_clip();
}

static void render_gradient(const Value &p, Frame &f, std::optional<double> now_o, std::optional<double> ms_o) {
  double now = now_o ? *now_o : p["now"].num(0);
  long long ms = (long long)floor(ms_o ? *ms_o : now * 1000);
  const BigGeo &g = cols_of(p) == WIDE ? BIG128 : BIG64;
  const int W = g.w;
  f.w = W;
  // Inverted (ginv): the digits carry the gradient on black, drawn as a
  // mask and then colored.
  if (p["ginv"].truthy()) {
    draw_big_time(f, g, p, now, hexc(0xffffff));
    for (int y = 0; y < 32; y++)
      for (int x = 0; x < W; x++)
        if (f.get(x, y).r) f.set(x, y, gradient_color(x, y, ms, W));
    return;
  }
  for (int y = 0; y < 32; y++)
    for (int x = 0; x < W; x++) f.set(x, y, gradient_color(x, y, ms, W));
  draw_big_time(f, g, p, now, RGB{});
}

// ---- announce screen (design spec §15; contract "Announce") ----
// Mirrors renderAnnounce() and MSG in draw.js: the server sends the lines
// already laid out for the style (messageLayout); this only draws them.
static const int MSG_BASES[4][3] = {{0, 0, 0}, {19, 0, 0}, {14, 24, 0}, {9, 19, 29}};
static const int MSG_SMALL_LINES = 5;
static const double TYPE_WAIT = 400, TYPE_CHAR = 90, TYPE_BLINK = 530;
static const int BIG_TOP = 7, BIG_GRAD = 14, BIG_TOP3 = 1;  // 2x; 3x (wide boards)
static const double ROLL_STEP = 150, ROLL_PAUSE = 1500;
static const int ROLL_START = 40, ROLL_PITCH = 10, ROLL_FADE = 3;
static constexpr RGB MSG_TEXT = C::label, MSG_TYPE = C::amber, MSG_CURSOR = hexc(0xcc8d00), BIG_FROM = hexc(0xff3060), BIG_TO = hexc(0xffb000), MSG_CTA = C::head;

static int msg_x(const Frame &f, Font font, const ustr &s) { return (int)fdiv(f.w - measure(font, s), 2); }

static std::vector<ustr> msg_lines(const Value &m) {
  std::vector<ustr> out;
  const Value &ls = m["lines"];
  for (size_t i = 0; i < ls.size(); i++) out.push_back(vstr(ls[i]));
  return out;
}

static void draw_note(Frame &f, const std::vector<ustr> &lines, bool sm) {
  if (sm) {
    int n = std::min((int)lines.size(), MSG_SMALL_LINES);
    int top = (int)fdiv(32 - (n * 6 - 1), 2);
    for (int i = 0; i < n; i++) f.text(FONT_SMALL, lines[i], msg_x(f, FONT_SMALL, lines[i]), top + 5 + i * 6, MSG_TEXT);
    return;
  }
  int n = std::min((int)lines.size(), 3);
  for (int i = 0; i < n; i++) f.text(FONT_5X7, lines[i], msg_x(f, FONT_5X7, lines[i]), MSG_BASES[n][i], MSG_TEXT);
}

static long long typed_total(const std::vector<ustr> &lines) {
  int n = std::min((int)lines.size(), 3);
  long long total = n - 1;
  for (int i = 0; i < n; i++) total += (long long)lines[i].size();
  return total;
}

static void draw_typed(Frame &f, const std::vector<ustr> &lines, std::optional<double> t) {
  int n = std::min((int)lines.size(), 3);
  long long total = typed_total(lines);
  long long typed = !t ? total : *t < TYPE_WAIT ? 0 : std::min(total, (long long)floor((*t - TYPE_WAIT) / TYPE_CHAR));
  long long left = typed;
  int last_x = 0, last_b = MSG_BASES[n][0];
  for (int i = 0; i < n && left >= 0; i++) {
    ustr part = lines[i].substr(0, (size_t)std::min<long long>(left, (long long)lines[i].size()));
    last_x = f.text(FONT_5X7, part, 0, MSG_BASES[n][i], MSG_TYPE);
    last_b = MSG_BASES[n][i];
    left -= (long long)lines[i].size() + 1;
  }
  double done_at = TYPE_WAIT + total * TYPE_CHAR;
  bool on = typed < total || !t || ((long long)floor((*t - done_at) / TYPE_BLINK)) % 2 == 0;
  if (on) f.fill(last_x, last_b - 7, 4, 7, MSG_CURSOR);
}

static RGB big_grad(int y, int span) {
  int k = clampi(y, 0, span);
  auto ch = [k, span](int a, int b) { return (uint8_t)jsround(a + (double)((b - a) * k) / span); };
  return RGB{ch(BIG_FROM.r, BIG_TO.r), ch(BIG_FROM.g, BIG_TO.g), ch(BIG_FROM.b, BIG_TO.b)};
}

static void draw_big(Frame &f, const ustr &s, bool x3) {
  const uint8_t *d = assets::FONT_DATA[FONT_5X7];
  int sc = x3 ? 3 : 2, y0 = x3 ? BIG_TOP3 : BIG_TOP, span = x3 ? BIG_GRAD * 3 / 2 : BIG_GRAD;
  int x0 = (int)fdiv(f.w - measure(FONT_5X7, s) * sc, 2);
  int x = 0;
  for (char32_t ch : s) {
    int o = glyph(FONT_5X7, ch);
    if (o < 0) continue;
    int dw = d[o], w = d[o + 1], h = d[o + 2], xo = d[o + 3] - 128, yo = d[o + 4] - 128;
    int top = 8 - (yo + h);
    for (int r = 0; r < h; r++) {
      int bits = glyph_row(d, o, r);
      for (int c = 0; c < w; c++) {
        if (!((bits >> (w - 1 - c)) & 1)) continue;
        int px = x + xo + c, py = top + r;
        for (int dy = 0; dy < sc; dy++)
          for (int dx = 0; dx < sc; dx++) f.set(x0 + px * sc + dx, y0 + py * sc + dy, big_grad(py * sc + dy, span));
      }
    }
    x += dw;
  }
}

// Credits roll; mirrors rollBase() / drawRoll() in draw.js.
static int roll_base(int n, std::optional<double> t) {
  if (!t) return (int)fdiv(32 - (ROLL_PITCH * (n - 1) + 9), 2) + 7;
  long long travel = ROLL_START + 2 + ROLL_PITCH * (n - 1);
  double cycle = travel * ROLL_STEP + ROLL_PAUSE;
  double u = *t - floor(*t / cycle) * cycle;
  return ROLL_START - (int)std::min(travel, (long long)floor(u / ROLL_STEP));
}

static void draw_roll(Frame &f, const std::vector<ustr> &lines, std::optional<double> t) {
  int base = roll_base((int)lines.size(), t);
  for (size_t i = 0; i < lines.size(); i++) f.text(FONT_5X7, lines[i], msg_x(f, FONT_5X7, lines[i]), base + (int)i * ROLL_PITCH, MSG_TEXT);
  for (int i = 0; i < ROLL_FADE; i++) {
    double k = (double)(i + 1) / (ROLL_FADE + 1);
    for (int y : {i, 31 - i})
      for (int x = 0; x < f.w; x++) f.set(x, y, scale_color(f.get(x, y), k));
  }
}

static bool has_message(const Value &m) { return m.truthy() && m["lines"].size() > 0; }

static void render_announce(const Value &p, Frame &f, std::optional<double> t) {
  if (cols_of(p) == WIDE) f.w = WIDE;
  const Value &m = p["msg"];
  if (!has_message(m)) {
    // No message yet: a call to action.
    f.text(FONT_SMALL, U"SET A MESSAGE", msg_x(f, FONT_SMALL, U"SET A MESSAGE"), 15, MSG_CTA);
    f.text(FONT_SMALL, U"ON YOUR PHONE", msg_x(f, FONT_SMALL, U"ON YOUR PHONE"), 22, MSG_CTA);
    return;
  }
  std::vector<ustr> lines = msg_lines(m);
  if (m["style"].eq("type")) draw_typed(f, lines, t);
  else if (m["style"].eq("big")) draw_big(f, lines[0], m["x3"].truthy());
  else if (m["style"].eq("roll")) draw_roll(f, lines, t);
  else draw_note(f, lines, m["sm"].truthy());
}

double message_intro_ms(const Value &m) {
  if (!has_message(m)) return 0;
  if (m["style"].eq("type")) return TYPE_WAIT + typed_total(msg_lines(m)) * TYPE_CHAR;
  return 0;
}

long long message_tick(const Value &m, double t) {
  if (has_message(m) && m["style"].eq("roll")) return (long long)floor(t / ROLL_STEP);
  if (!has_message(m) || !m["style"].eq("type")) return 0;
  double intro = message_intro_ms(m);
  return t < intro ? -1 : ((long long)floor((t - intro) / TYPE_BLINK)) % 2;
}

// ---- whole screen ----

static void apply_brightness(Frame &f, double b) {
  double k = std::max(0.0, std::min(100.0, b)) / 100;
  if (k == 1) return;
  for (size_t i = 0; i < f.bytes(); i++) f.px[i] = (uint8_t)jsround(f.px[i] * k);
}

// The skyline, crossfading from o.sky_from when a fade is running (draw.js
// renderSkyline with opts.skyFrom): both scenes drawn whole, mixed by sky_k.
static void render_skyline_faded(const Value &p, Frame &f, const RenderOpts &o) {
  const Value &cur = o.sky ? *o.sky : p["skyline"];
  if (o.sky_from && o.sky_from->truthy() && o.sky_k < 1) {
    static Frame &a = *big_frame();  // not on the loop task's small stack; PSRAM on the board
    a.clear();
    render_skyline(p, *o.sky_from, a, o.now, o.ms, o.blink, o.sky_bare ? nullptr : o.clouds);
    render_skyline(p, cur, f, o.now, o.ms, o.blink, o.clouds);
    for (int y = 0; y < Frame::H; y++)
      for (int x = 0; x < f.w; x++) f.set(x, y, mix_rgb(a.get(x, y), f.get(x, y), o.sky_k));
    return;
  }
  render_skyline(p, cur, f, o.now, o.ms, o.blink, o.clouds);
}

void SkylineFader::view(double ms, RenderOpts &o) const {
  o.sky = &cur_;
  o.sky_from = fading_ ? &from_ : nullptr;
  o.sky_bare = fading_ && from_bare_;
  o.sky_k = fading_ ? sstep01(0, 1, (ms - start_) / SKY_FADE_MS) : 1;
}

std::vector<std::string> SkylineFader::wanted() const {
  std::vector<std::string> out;
  for (const Value *v : {&cur_, fading_ ? &from_ : nullptr, has_pending_ ? &pending_ : nullptr})
    if (v && v->truthy() && (*v)["cl"].truthy() && (*v)["cl"]["id"].is_str()) out.push_back(json::str((*v)["cl"]["id"]));
  return out;
}

// ---- clock screen: big digits and day/date faces (design spec §20) ----
// Mirrors renderDigits() / renderDayDate() and BD / DD in draw.js. The d17
// and d13 fonts' advance carries a 2 px gap, so a time's ink is measure() - 1.
static const int BD_TOP = 7, BD_BASE = 24;
static const int DD_DAY_BASE = 6, DD_TIME_BASE = 22, DD_DATE_BASE = 31;

// Wide board: the d23 digits, rows 4-26, centered on 128 columns.
static const int BDW_TOP = 4, BDW_BASE = 27;

// The time's color on both faces: p.cdig (the board's digitColor), else #e6e6e6.
static RGB digit_color(const Value &p) { return p["cdig"].truthy() ? hexs(p["cdig"].str_or("")) : hexc(0xe6e6e6); }

static void render_digits(const Value &p, Frame &f, std::optional<double> now_o, std::optional<double> ms_o) {
  double now = now_o ? *now_o : p["now"].num(0);
  long long ms = (long long)floor(ms_o ? *ms_o : now * 1000);
  bool wide = cols_of(p) == WIDE;
  Font font = wide ? FONT_D23 : FONT_D17;
  int W = wide ? WIDE : 64, top = wide ? BDW_TOP : BD_TOP, base = wide ? BDW_BASE : BD_BASE;
  f.w = W;
  ustr text = clock_text(now, p["tzo"].num(0));
  // Ink centered: x = floor((W + 1 - measure) / 2) (draw.js xOf).
  std::optional<Roll> roll = take_roll("dig.clock", text);
  roll_text_at(f, font, text, SPAN, W, base, digit_color(p), roll);
  // The colon blinks: off for the second half of each second, never mid-roll,
  // never with steady.
  if (!p["steady"].truthy() && !roll && fmod_floor(ms, 1000) >= 500) {
    size_t i = text.find(U':');
    int g = glyph(font, ':');
    int cw = g >= 0 ? assets::FONT_DATA[font][g + 1] : 0;
    f.fill(align_x(font, text, SPAN, W) + measure(font, text.substr(0, i)) + 1, top, cw, base - top, hexc(0x000000));
  }
}

// Wide day/date (draw.js renderDayDateWide): weekday over date on the left,
// a divider, the time and AM/PM centered in columns 48-127.
static const int DDW_CX = 22, DDW_DAY_BASE = 14, DDW_DATE_BASE = 25, DDW_DIV_X = 46, DDW_X0 = 48, DDW_TIME_BASE = 27;
static void render_daydate_wide(const Value &p, Frame &f, double now) {
  f.w = WIDE;
  double tzo = p["tzo"].num(0);
  LocalDate t = local_date(now, tzo);
  ustr day = U(DAY_NAMES[t.wd]), date = U(std::string(MONTH_NAMES[t.m - 1]) + " " + std::to_string(t.d));
  f.text(FONT_5X7, day, DDW_CX - (int)fdiv(measure(FONT_5X7, day), 2), DDW_DAY_BASE, C::wxText);
  f.text(FONT_5X7, date, DDW_CX - (int)fdiv(measure(FONT_5X7, date), 2), DDW_DATE_BASE, hexc(0xe6e6e6));
  f.fill(DDW_DIV_X, 4, 1, 24, hexc(0x262626));
  ustr text = clock_text(now, tzo), ampm = U(t.h < 12 ? "AM" : "PM");
  int aw = measure(FONT_SMALL, ampm);
  // x = 48 + floor((80 - (measure + 3 + aw)) / 2): CENTER in columns 48 to 124 - aw.
  int end = WIDE - 3 - aw;
  roll_named(f, FONT_D23, "dd.clock", text, CENTER, DDW_X0, DDW_TIME_BASE, digit_color(p), end);
  f.text(FONT_SMALL, ampm, align_x(FONT_D23, text, CENTER, DDW_X0, end) + measure(FONT_D23, text) + 3, DDW_TIME_BASE, C::dimHead);
}

static void render_daydate(const Value &p, Frame &f, std::optional<double> now_o) {
  double now = floor(now_o ? *now_o : p["now"].num(0));
  if (cols_of(p) == WIDE) return render_daydate_wide(p, f, now);
  double tzo = p["tzo"].num(0);
  LocalDate t = local_date(now, tzo);
  ustr day = U(DAY_NAMES[t.wd]);
  f.text(FONT_SMALL, day, (int)fdiv(64 - measure(FONT_SMALL, day), 2), DD_DAY_BASE, C::wxText);
  ustr text = clock_text(now, tzo), ampm = U(t.h < 12 ? "AM" : "PM");
  int aw = measure(FONT_SMALL, ampm);
  // The time and AM/PM centered as a pair: x = floor((63 - aw - measure) / 2)
  // (draw.js xOf), which is CENTER from column -(aw + 1).
  roll_named(f, FONT_D13, "dd.clock", text, CENTER, -(aw + 1), DD_TIME_BASE, digit_color(p));
  f.text(FONT_SMALL, ampm, align_x(FONT_D13, text, CENTER, -(aw + 1)) + measure(FONT_D13, text) + 1, DD_TIME_BASE, C::dimHead);
  ustr date = U(std::string(MONTH_NAMES[t.m - 1]) + " " + std::to_string(t.d));
  f.text(FONT_5X7, date, (int)fdiv(64 - measure(FONT_5X7, date), 2), DD_DATE_BASE, C::wxText);
}

static void render_clock(const Value &p, Frame &f, const RenderOpts &o) {
  std::string face = json::str(p["cface"]);
  if (face == "seventies") render_seventies(p, f, o.now);
  else if (face == "analog") render_analog(p, f, o.now);
  else if (face == "daynight") render_daynight(p, f, o.now);
  else if (face == "gradient") render_gradient(p, f, o.now, o.ms);
  else if (face == "digits") render_digits(p, f, o.now, o.ms);
  else if (face == "daydate") render_daydate(p, f, o.now);
  else if (face == "words" && cols_of(p) == WIDE) render_words(p, f, o.now);
  else render_skyline_faded(p, f, o);
}

Frame &render(const Value &p, Frame &f, const RenderOpts &o) {
  std::string screen = o.screen ? o.screen : json::str(p["screen"]);
  if (!o.screen && !p["screen"].truthy()) screen = "";
  g_roller = o.roller;
  g_nums = o.nums;
  g_still = p["croll"].is_false();
  g_icon_t = o.icon_t;
  if (screen == "peek") render_peek(p, f, o);
  else if (screen == "chooser") render_chooser(p, f, o.chooser_pos.value_or(0), o.chooser_commit);
  else if (screen == "ticker") render_ticker(p, f, o.now, o.page, o.slide);
  else if (screen == "weather") render_weather(p, f, o.now, o.idx, o.frames, o.blink);
  else if (screen == "baseball") render_baseball(p, f, o.now, o.game, o.rolls, o.logos);
  else if (screen == "clock") render_clock(p, f, o);
  else if (screen == "announce") render_announce(p, f, o.t);
  else render_transit(p, f, o.now, o.blink, o.view);
  g_roller = nullptr;
  g_nums = nullptr;
  g_still = false;
  g_icon_t.reset();
  if (o.roller) o.roller->end();  // the Player calls begin(); render() ends the frame
  widen(f, cols_of(p));
  if (o.apply_bright) apply_brightness(f, o.bright ? *o.bright : p["bright"].is_null() ? 100 : p["bright"].num());
  if (o.slide_from) slide_frames(o.slide_from, f, slide_offset(o.slide_t, f.w), o.slide_dir, o.from_w);
  else if (o.fade_from) fade_frames(o.fade_from, f, o.fade_t, o.from_w);
  return f;
}

int slide_offset(double t, int w) {
  return (int)jsround(ease_in_out(std::max(0.0, std::min(1.0, t / SCREEN_SLIDE_MS))) * (w + SLIDE_GAP));
}

// The `from` pixels as wide as f, as the panels showed them: a narrower
// frame (a 64 payload on a 128 board) on both panels; a wider one by its
// left columns. The only place a transition changes width.
static const uint8_t *from_px(const uint8_t *from, int from_w, const Frame &f) {
  if (from_w == f.w) return from;
  static uint8_t *const buf = big_bytes(Frame::MAX_W * Frame::H * 3);
  const int w = std::max(1, std::min(from_w, Frame::MAX_W));
  for (int y = 0; y < Frame::H; y++)
    for (int x = 0; x < f.w; x++) memcpy(buf + (y * f.w + x) * 3, from + (y * w + x % w) * 3, 3);
  return buf;
}

void slide_frames(const uint8_t *from, Frame &f, int d, int dir, int from_w) {
  from = from_px(from, from_w, f);
  const int w = f.w, h = Frame::H;
  static uint8_t *const cur = big_bytes(Frame::MAX_W * Frame::H * 3);  // kept; PSRAM on the board
  memcpy(cur, f.px, f.bytes());
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      // Which frame, and which of its columns, lands on column x (none: the gap).
      const uint8_t *src = nullptr;
      int sx = 0;
      if (dir >= 0) {
        if (x < w - d) src = from, sx = x + d;
        else if (x >= w - d + SLIDE_GAP) src = cur, sx = x - (w - d + SLIDE_GAP);
      } else if (x >= d) {
        src = from, sx = x - d;
      } else if (x < d - SLIDE_GAP) {
        src = cur, sx = x + w - (d - SLIDE_GAP);
      }
      int i = (y * w + x) * 3, j = (y * w + sx) * 3;
      f.px[i] = src ? src[j] : 0;
      f.px[i + 1] = src ? src[j + 1] : 0;
      f.px[i + 2] = src ? src[j + 2] : 0;
    }
}

void fade_frames(const uint8_t *from, Frame &f, double t, int from_w) {
  from = from_px(from, from_w, f);
  bool out = t < SCREEN_FADE_OUT_MS;
  double k = out ? 1 - std::max(0.0, t) / SCREEN_FADE_OUT_MS : std::min(1.0, (t - SCREEN_FADE_OUT_MS) / SCREEN_FADE_IN_MS);
  const uint8_t *src = out ? from : f.px;
  for (size_t i = 0; i < f.bytes(); i++) f.px[i] = (uint8_t)jsround(src[i] * k);
}

// ---- status screens (firmware/boardlib/status.py) ----

static void center(Frame &f, Font font, const ustr &s, int base, RGB color) {
  f.text(font, s, (int)fdiv(f.w - measure(font, s), 2), base, color);
}

static std::string upper(std::string s) {
  for (char &c : s)
    if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
  return s;
}

static ustr first(const ustr &s, size_t n) { return s.substr(0, std::min(n, s.size())); }

void render_status(Frame &f, const std::string &kind, const std::string &detail, int cols) {
  f.w = cols == WIDE ? WIDE : 64;
  const bool wide = f.w == WIDE;
  const size_t room = wide ? 31 : 15;  // Tom Thumb characters on a line
  ustr d = U(upper(detail));
  if (kind == "connecting") {
    center(f, FONT_5X7, U"WIFI", 13, C::grey);
    center(f, FONT_SMALL, first(d, room), 22, C::grey);
  } else if (kind == "ok") {
    center(f, FONT_5X7, U"WIFI OK", 13, C::label);
    center(f, FONT_SMALL, first(d, room), 22, C::grey);
  } else if (kind == "portal" && wide) {
    // MAC on one line, for IT to whitelist.
    center(f, FONT_5X7, U"PORTAL", 13, C::amber);
    center(f, FONT_SMALL, first(d, 17), 22, C::label);
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
    center(f, FONT_SMALL, first(detail.empty() ? U"RETRYING" : d, room), 22, C::grey);
  } else if (kind == "updating") {
    // OTA install (S3 only): detail is the percent downloaded.
    center(f, FONT_5X7, U"UPDATING", 13, C::label);
    center(f, FONT_SMALL, first(d, 4) + U"%", 22, C::amber);
  } else if (kind == "setup") {
    // WiFi setup: detail is the board's own network to join (also on its label).
    center(f, FONT_5X7, U"SETUP WIFI", 13, C::amber);
    center(f, FONT_SMALL, first(U(detail), wide ? 32 : 16), 22, C::label);
  } else if (kind == "nosetup") {
    // No settings in flash (a generic build on a board never set up): detail says what's missing.
    center(f, FONT_5X7, U"NO SETUP", 13, C::amber);
    center(f, FONT_SMALL, U"SEE README", 22, C::grey);
  }
}

}  // namespace draw
