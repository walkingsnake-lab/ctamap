// Board drawing for the Matrix Portal S3: a line-by-line port of
// firmware/boardlib/draw.py, itself a port of server/board/draw.js (the
// reference renderer). Given the same payload, time, and animation state,
// it must produce the same pixels; firmware-s3/tests/parity checks that
// against draw.js. Change draw.js first, then mirror it in draw.py and here.
//
// Function names follow draw.py (snake_case), so a change there is easy to
// find here. Differences from draw.py, all deliberate:
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
enum Font { FONT_5X7 = 0, FONT_CLOCK = 1, FONT_SMALL = 2 };

// ---- frame ----

// 64x32 RGB framebuffer. The board draws into one and copies it to the panel.
class Frame {
 public:
  static const int W = 64;
  static const int H = 32;
  uint8_t px[W * H * 3];

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

// ---- colors ----

namespace C {
constexpr RGB label = hexc(0xd8d8d8), clock = hexc(0xcccccc), radarTime = hexc(0x7a7a7a),
              radarAmpm = hexc(0x8f8f8f), radarSub = hexc(0x666666), wxText = hexc(0x8f8f8f),
              amber = hexc(0xffb000), dimAmber = hexc(0x664600), dimAmber2 = hexc(0x332300),
              sch = hexc(0x6a6a6a), schDim = hexc(0x2e2e2e), schDim2 = hexc(0x151515), grey = hexc(0x8f8f8f), divider = hexc(0x333333),
              head = hexc(0x808080), dimHead = hexc(0x555555), index = hexc(0x2d2d2d),
              white = hexc(0xffffff), red = hexc(0xff2020), watch = hexc(0xffd800),
              warnSevere = hexc(0xff8000), warnTornado = hexc(0xff2020), noTrains = hexc(0x6c6c6c),
              indicator = hexc(0x3a3a3a);
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
  bool a = false;
  std::optional<int> num;
  std::optional<Roll> numRoll;
  double top = 0;
  double alpha = 1;
  std::vector<ViewCell> cells;
};

struct View {
  double now = 0;
  std::string mode;  // "dest" or "chrono"
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
    bool a = false;
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
  std::optional<double> t;
  NumRoller *roller = nullptr;
  const Rolls *nums = nullptr;  // fixed clock rolls (tests)
  bool apply_bright = true;     // false: the display dims in hardware (payload `bright`)
};

Frame &render(const Value &p, Frame &f, const RenderOpts &o);

int ticker_pages(const Value &p, double now);
int radar_on_hand(const Value &ids, const Frames *frames);
int radar_loop_idx(const Value &ids, const Frames *frames, double t, const Timing &tm);
bool rain_bars_turn(const Value &rn, int n, const Timing &tm, double t);

struct PickedGame {
  int i, pos, of;
};
PickedGame pick_game(const Value &games, double now, double every, bool all_games);

struct BaseballTexts {
  std::string key;
  std::map<std::string, ustr> texts;
};
std::optional<BaseballTexts> baseball_texts(const Value &p, double now);

// Status screens (firmware/boardlib/status.py).
void render_status(Frame &f, const std::string &kind, const std::string &detail);

}  // namespace draw
