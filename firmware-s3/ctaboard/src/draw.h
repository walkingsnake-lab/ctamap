// Board drawing for the Matrix Portal S3. server/board/draw.js is the
// reference renderer: given the same payload, time, and animation state,
// this must produce the same pixels, and firmware-s3/tests/parity checks
// that against draw.js. Change draw.js first, then mirror it here.
//
// It began as a line-by-line port of firmware/boardlib/draw.py (the M4's,
// now frozen), so older code follows draw.py's snake_case names; newer
// code (the skyline) ports draw.js directly. Follow draw.js, not draw.py,
// when changing or restructuring it. Deliberate differences from the
// Python:
//   - Payloads are json::Value (Python dict semantics, see json.h).
//   - Text is std::u32string (one element per character, like a Python
//     str); payload strings are UTF-8 and converted with U().
//   - Python's floor division and modulo are fdiv()/fmod_floor(): C++'s
//     / and % truncate toward zero.
//   - Optional values (Python None) are std::optional.
//
// Platform independent: no Arduino headers, so it builds natively for tests.
#pragma once

#include <stdint.h>

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "json.h"

namespace draw {

using json::Value;
using ustr = std::u32string;

// ---- basics ----

struct RGB {
  uint8_t r = 0, g = 0, b = 0;
};
inline bool operator==(RGB a, RGB b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
inline bool operator!=(RGB a, RGB b) { return !(a == b); }
constexpr RGB hexc(uint32_t v) { return RGB{(uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)v}; }

double jsround(double x);
long long fdiv(long long a, long long b);        // Python a // b
long long fmod_floor(long long a, long long b);  // Python a % b
ustr U(const std::string &utf8);
ustr U(const char *utf8);
std::string utf8(const ustr &s);
ustr num_text(long long n);  // str(int)

// Fonts, in assets.h order (sorted names).
enum Font { FONT_5X7 = 0, FONT_CLOCK = 1, FONT_D13 = 2, FONT_D17 = 3, FONT_D23 = 4, FONT_SMALL = 5, FONT_VCR = 6 };

// ---- frame ----

// RGB framebuffer, w x 32: 64 wide, or 128 for two chained panels (payload
// `cols`). Rows are w pixels apart in px. The board draws into one and
// copies it to the panel. Screens draw at 64; render() widens the frame
// for a 128 payload (widen()).
class Frame {
 public:
  static const int MAX_W = 128;
  static const int H = 32;
  int w = 64;
  uint8_t px[MAX_W * H * 3];
  size_t bytes() const { return (size_t)w * H * 3; }
  // The panel's dim-color floor (color.h): false lets colors too dark for the
  // panel go black instead of lifting them, and has the panel use its
  // full-depth night curve at every brightness (the skyline face). Not a
  // pixel: parity compares px only.
  bool floor = true;

  Frame() { clear(); }
  void clear();
  void set(int x, int y, RGB c);
  RGB get(int x, int y) const;
  void fill(int x, int y, int w, int h, RGB c);
  void push_clip(int x0, int y0, int x1, int y1);
  void pop_clip();
  // Text with its baseline at row `baseline`. Returns x after the last advance.
  int text(Font font, const ustr &s, int x, int baseline, RGB c);

 private:
  struct Clip {
    bool on;
    int x0, y0, x1, y1;
  };
  Clip clip_{false, 0, 0, 0, 0};
  std::vector<Clip> clips_;
};

int measure(Font font, const ustr &s);

// ---- width (draw.js WIDE, colsOf, widenPx) ----
const int WIDE = 128;
// The payload's width: 128 for `cols` 128, else 64.
int cols_of(const Value &p);
// Repeats each row of a frame from_w wide across to_w columns, in place
// (px must hold to_w x 32).
void widen_px(uint8_t *px, int from_w, int to_w);
// f as the board shows it on a panel cols wide: a 64-wide screen on both panels.
void widen(Frame &f, int cols);

// ---- colors ----

namespace C {
constexpr RGB label = hexc(0xd8d8d8), clock = hexc(0xcccccc), radarTime = hexc(0x7a7a7a),
              radarAmpm = hexc(0x8f8f8f), radarSub = hexc(0x666666), wxText = hexc(0x8f8f8f),
              amber = hexc(0xffb000), dimAmber = hexc(0x664600), dimAmber2 = hexc(0x332300),
              sch = hexc(0x6a6a6a), schDim = hexc(0x2e2e2e), schDim2 = hexc(0x151515), grey = hexc(0x8f8f8f), divider = hexc(0x333333),
              head = hexc(0x808080), dimHead = hexc(0x555555), index = hexc(0x2d2d2d),
              white = hexc(0xffffff), red = hexc(0xff2020), watch = hexc(0xffd800),
              warnSevere = hexc(0xff8000), warnTornado = hexc(0xff2020), noTrains = hexc(0x6c6c6c),
              indicator = hexc(0x3a3a3a), perch = hexc(0x4a4a4a);
}
RGB line_color(const std::string &ln);
RGB scale_color(RGB c, double k);
RGB fade(RGB c, double alpha);

// ---- timing ----

const double ROLL_MS = 400, FADE_MS = 700, MOVE_MS = 500, COLOR_MS = 700, MATCH_S = 90, BLINK_MS = 1000;
const long long DROP_GRACE = 30, HOLD_MAX = 60;

struct Timing {
  double pageHold, slide, radarFrame, radarHold, game;
};
Timing timing(const Value &p);

long long minutes_until(double t, double now);
bool is_shown(double x, double now, const Value &pnow);
double ease_in_out(double x);

// ---- rolls ----

struct Roll {
  ustr from;
  double p;
};

// Clock rolls on one screen; mirrors createNumRoller() in draw.js.
// begin(ms), render(..., roller), and render() ends the frame.
class NumRoller {
 public:
  void begin(double ms);
  std::optional<Roll> take(const std::string &name, const ustr &text);
  void end();
  void reset();
  bool busy(double ms) const;
  bool clock() const;  // a clock on screen: it rolls at every minute

 private:
  struct Live {
    ustr from;
    double start;
  };
  std::map<std::string, ustr> prev_, cur_;
  std::map<std::string, Live> live_;
  double t_ = 0;
};

using Rolls = std::map<std::string, Roll>;

// ---- transit view ----

struct ViewCell {
  double t = 0;
  ustr text;
  double right = 0;
  double alpha = 1;
  std::optional<Roll> roll;
  RGB color;
};

struct ViewRow {
  std::string key, ln;
  ustr lbl;
  // A wide board's halves (draw.js buildHalvesView): h 0 or 1 (-1: none),
  // the row's columns x0..right (right -1: the frame's last column).
  int h = -1, x0 = 0, right = -1;
  bool a = false;
  std::optional<ustr> al;  // alert label (payload `al`), with `a`
  std::optional<ustr> aw;  // wide rows: the alert's words (payload `aw`)
  std::optional<int> num;
  std::optional<Roll> numRoll;
  double top = 0;
  double alpha = 1;
  std::vector<ViewCell> cells;
};

struct View {
  double now = 0;
  std::string mode;  // "dest", "chrono", or a wide board's "split" / "cols2"
  int w = 64;        // the frame it draws in: 128 for a wide payload (cols)
  std::vector<ustr> halves;  // split: the halves' labels
  bool has_header = false;
  ustr header;
  const Value *wx = nullptr;    // null when absent or falsy
  const Value *warn = nullptr;  // null when absent or falsy
  bool hdiv = false, key = false, clock = true, lnc = false, stale = false;
  double tzo = 0;
  double pitch = 6;
  std::vector<ViewRow> rows;
};

View build_transit_view(const Value &p, double now);

// Keeps arrivals' identity across frames and updates so the board can
// animate what changed (rolls, fades, color easing, row slides). step()
// returns the view to draw at animation time t (ms).
class TransitAnimator {
 public:
  struct CellState {
    double t = 0;
    ustr text;
    double right = 0;
    RGB color;
    bool has_roll = false;
    ustr roll_from;
    double roll_start = 0;
    std::optional<RGB> fromColor, shownColor;
    std::optional<double> colorStart, fromRight, moveStart, shownRight, leaving, born;
  };
  using CellP = std::shared_ptr<CellState>;
  struct RowState {
    std::string key, ln, mode;
    ustr lbl;
    int h = -1, x0 = 0, right = -1;
    bool a = false;
    std::optional<ustr> al;
    std::optional<ustr> aw;
    double top = 0, shownTop = 0;
    std::optional<double> born, fromTop, moveStart, leaving;
    std::vector<CellP> cells;
    std::optional<int> num;
    bool has_numRoll = false;
    ustr numRoll_from;
    double numRoll_start = 0;
  };
  using RowP = std::shared_ptr<RowState>;

  View step(const Value &p, double now, double t);
  // Insertion-ordered like a JS Map: a re-set key keeps its position.
  std::vector<std::pair<std::string, RowP>> rows;

 private:
  void match_cells(RowState &state, const std::vector<ViewCell> &cells, double t, bool is_new_row);
  RowP find(const std::string &key) const;
  void erase(const std::string &key);
};

// ---- screens ----

using Frames = std::map<std::string, std::vector<uint8_t>>;  // radar frame id -> bytes
using Logos = std::map<std::string, std::vector<uint8_t>>;   // logo id -> 24 x 12 RGB

struct RenderOpts {
  const char *screen = nullptr;  // null: the payload's
  std::optional<double> now;
  bool blink = false;
  const View *view = nullptr;
  int page = 0;
  double slide = 0;
  std::optional<int> idx;
  const Frames *frames = nullptr;  // null: Python's None
  std::optional<int> game;
  const Rolls *rolls = nullptr;
  const Logos *logos = nullptr;
  std::optional<double> t;  // weather: ms into the radar loop; announce: ms since the message appeared (none: settled)
  NumRoller *roller = nullptr;
  const Rolls *nums = nullptr;  // fixed clock rolls (tests)
  bool apply_bright = true;     // false: the display dims in hardware (payload `bright`)
  std::optional<double> bright;  // percent in place of the payload's `bright` (the light sensor)
  // Knob chooser (screen "chooser"): wheel position and commit (draw.js opts.chooser).
  std::optional<double> chooser_pos;
  bool chooser_commit = false;
  // Peek chooser (screen "peek"; draw.js opts.peek): the view (ring index k,
  // variant vi), the bar's drop in rows, and the slide from another view
  // (draw.js peek.slide: its k and vi, ms in, vertical or sideways, dir).
  // view / slide_view: the views' payloads already built by peek_view()
  // (null: built here). Weather in a peek: the newest frame on hand, still.
  struct Peek {
    int k = 0, vi = 0, drop = 0;
    bool slide = false;
    int slide_k = 0, slide_vi = 0, slide_dir = 1;
    double slide_t = 0;
    bool slide_y = false;
    const Value *view = nullptr, *slide_view = nullptr;
  };
  std::optional<Peek> peek;
  // Clock screen (skyline face): the animation clock in epoch ms (null: now x 1000)
  // and the cloud strips on hand (strip id -> 1664 packed bytes).
  std::optional<double> ms;
  const Frames *clouds = nullptr;
  // Skyline crossfade (draw.js opts.sky / skyFrom / skyK / skyBare): the
  // skyline to draw in place of the payload's (null: the payload's), the one
  // fading from (null: none), how far (0..1), and whether to draw that one
  // without clouds (its strip just arrived).
  const Value *sky = nullptr;
  const Value *sky_from = nullptr;
  double sky_k = 1;
  bool sky_bare = false;
  // Screen-change slide (draw.js opts.slide): the old screen's last shown
  // pixels, ms into the slide, and the direction (1: the new screen comes
  // in from the right; -1: from the left).
  const uint8_t *slide_from = nullptr;
  double slide_t = 0;
  int slide_dir = 1;
  // Screen-change fade (draw.js opts.fade): the old screen's last shown
  // pixels and ms into the fade. Used only without a slide.
  const uint8_t *fade_from = nullptr;
  double fade_t = 0;
  // How wide slide_from / fade_from is (64, or 128 on a wide board).
  int from_w = 64;
  // The icon clock (draw.js opts.iconT), ms on the board's clock: the overnight owl.
  std::optional<double> icon_t;
};

// Screen change: the new screen pushes the old one's last frame off
// sideways, SLIDE_GAP unlit columns between them.
const double SCREEN_SLIDE_MS = 450;
const int SLIDE_GAP = 4;
// px the new screen has come in across a panel w wide, 0..w + SLIDE_GAP
int slide_offset(double t, int w = 64);
// Overnight owl: its frame (assets::OWL_FRAMES) at icon-clock ms t; 0 without one.
int owl_frame(std::optional<double> t);
// from: the old frame's pixels, from_w wide (narrower than f: widened first).
void slide_frames(const uint8_t *from, Frame &f, int d, int dir, int from_w = 64);
// Screen change from the phone or the auto rotation: the old frame fades to
// black, then the new one fades in (draw.js fadeFrames).
const double SCREEN_FADE_OUT_MS = 125, SCREEN_FADE_IN_MS = 125;
const double SCREEN_FADE_MS = SCREEN_FADE_OUT_MS + SCREEN_FADE_IN_MS;
void fade_frames(const uint8_t *from, Frame &f, double t, int from_w = 64);

Frame &render(const Value &p, Frame &f, const RenderOpts &o);

// ---- peek chooser (draw.js renderPeek, PEEK) ----
const double PEEK_X_MS = 270, PEEK_Y_MS = 300, PEEK_UP_MS = 240, PEEK_DOWN_MS = 390;
const int PEEK_BAND = 11;
// A variant's payload and screen (draw.js peekView): `own` when the
// payload had to change (weather, clock), `v` holds it then.
struct PeekView {
  std::string screen;
  bool own = false;
  Value v;
  const Value &payload(const Value &p) const { return own ? v : p; }
};
PeekView peek_view(const Value &p, int k, int vi);
std::string peek_screen(const Value &p, int k, int vi);  // just the screen, no copy
int peek_shift(bool y, double t, int w = 64);  // px slid at t ms: 0..w across, 0..32 down
int peek_drop(bool up, double t);  // rows the bar has dropped at t ms (rising: up)

// Announce screen (draw.js messageIntroMs / messageTick): how long a message's
// intro runs (ms; 0 for the still styles), and after it a number that changes
// whenever the frame does (the typewriter cursor's blink; -1 during the intro).
double message_intro_ms(const Value &m);
long long message_tick(const Value &m, double t);

// Which skyline is on screen and the crossfade from the last (draw.js
// createSkylineFader; same rules): set() with each payload's skyline (live:
// the clock screen shows; off it, taken at once), tick() every frame, then
// view() into the render options. `has` says whether a cloud strip is on hand.
const double SKY_FADE_MS = 4000;
class SkylineFader {
 public:
  template <class Has>
  void set(const Value &sk, double ms, Has has, bool live) {
    (void)ms;
    if (!started_ || !live) {
      started_ = true;
      cur_ = sk;
      cur_bare_ = !ready(cur_, has);
      fading_ = false;
      from_ = Value();
      has_pending_ = false;
      return;
    }
    if (json::equal(sk, cur_)) has_pending_ = false;
    else { pending_ = sk; has_pending_ = true; }
  }
  template <class Has>
  void tick(double ms, Has has) {
    if (fading_ && ms - start_ >= SKY_FADE_MS) { fading_ = false; from_ = Value(); }
    if (fading_) return;
    if (has_pending_ && ready(pending_, has)) {
      from_ = std::move(cur_);
      from_bare_ = cur_bare_;
      cur_ = std::move(pending_);
      pending_ = Value();
      has_pending_ = false;
      cur_bare_ = false;
      start_ = ms;
      fading_ = true;
    } else if (started_ && cur_bare_ && ready(cur_, has)) {
      from_ = cur_;
      from_bare_ = true;
      cur_bare_ = false;
      start_ = ms;
      fading_ = true;
    }
  }
  // Fills o.sky / sky_from / sky_k / sky_bare (pointers into this fader).
  void view(double ms, RenderOpts &o) const;
  std::vector<std::string> wanted() const;  // strip ids still needed
  bool started() const { return started_; }

 private:
  template <class Has>
  static bool ready(const Value &sk, Has has) {
    return !sk.truthy() || !sk["cl"].truthy() || has(json::str(sk["cl"]["id"]));
  }
  bool started_ = false, cur_bare_ = false, from_bare_ = false, has_pending_ = false, fading_ = false;
  Value cur_, from_, pending_;
  double start_ = 0;
};

// Skyline face: where the quarter-hour boat is at epoch ms (draw.js boatAt),
// and the lightning level 0-1 (strikeLevel).
struct Boat {
  bool sail;  // false: the speedboat
  int x0, dir;
};
std::optional<Boat> boat_at(double ms, int w = 64);
double strike_level(double ms);

int ticker_pages(const Value &p, double now);
int radar_on_hand(const Value &ids, const Frames *frames);
int radar_loop_idx(const Value &ids, const Frames *frames, double t, const Timing &tm);

struct PickedGame {
  int i, pos, of;
};
PickedGame pick_game(const Value &games, double now, double every, bool all_games);

struct BaseballTexts {
  std::string key;
  std::map<std::string, ustr> texts;
};
std::optional<BaseballTexts> baseball_texts(const Value &p, double now);

// Status screens (firmware/boardlib/status.py, plus the S3's "updating"
// and "nosetup").
void render_status(Frame &f, const std::string &kind, const std::string &detail);

}  // namespace draw
