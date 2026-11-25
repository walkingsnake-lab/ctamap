// A small QR encoder for the WiFi setup screen (draw::render_setup): the
// board's own network as a code a phone's camera joins. Byte mode, error
// correction L, versions 1-3 only (21, 25 and 29 modules: what fits the
// panel's 32 rows at one LED per module), so one Reed-Solomon block and no
// version information. The mask is the one with the lowest penalty, scored
// as the `qrcode` npm package scores it (the control page and the label
// script use it), so the board draws the same code: tests/qr_test.cpp checks
// every module against it. Plain C++, no Arduino.
#pragma once

#include <stdint.h>
#include <string.h>

#include <string>

namespace qr {

const int MAX_N = 29;        // version 3
const size_t MAX_TEXT = 53;  // bytes a version 3-L code holds in byte mode

struct Code {
  int n = 0;  // modules a side: 21, 25 or 29
  uint8_t m[MAX_N * MAX_N];
  bool dark(int x, int y) const { return m[y * n + x] != 0; }
};

// The text of a WiFi code (phones offer to join): WPA with a password, open
// without. ; , : \ " are escaped, as in setup-image.js wifiQrText.
inline std::string wifi_text(const std::string &name, const std::string &pass) {
  auto esc = [](const std::string &s) {
    std::string o;
    for (char c : s) {
      if (c == '\\' || c == ';' || c == ',' || c == ':' || c == '"') o += '\\';
      o += c;
    }
    return o;
  };
  if (pass.empty()) return "WIFI:T:nopass;S:" + esc(name) + ";;";
  return "WIFI:T:WPA;S:" + esc(name) + ";P:" + esc(pass) + ";;";
}

namespace detail {

inline uint8_t gf_mul(uint8_t x, uint8_t y) {  // GF(2^8), polynomial 0x11D
  int z = 0;
  for (int i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >> 7) * 0x11D);
    z ^= ((y >> i) & 1) * x;
  }
  return (uint8_t)z;
}

struct Grid {
  int n;
  uint8_t m[MAX_N * MAX_N];   // 1: dark
  uint8_t fn[MAX_N * MAX_N];  // 1: a function module (never masked, never data)
  void put(int x, int y, bool dark) {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    m[y * n + x] = dark;
    fn[y * n + x] = 1;
  }
};

inline bool mask_bit(int mask, int r, int c) {
  switch (mask) {
    case 0: return (r + c) % 2 == 0;
    case 1: return r % 2 == 0;
    case 2: return c % 3 == 0;
    case 3: return (r + c) % 3 == 0;
    case 4: return (r / 2 + c / 3) % 2 == 0;
    case 5: return (r * c) % 2 + (r * c) % 3 == 0;
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 == 0;
    default: return ((r * c) % 3 + (r + c) % 2) % 2 == 0;
  }
}

inline void apply_mask(Grid &g, int mask) {
  for (int r = 0; r < g.n; r++)
    for (int c = 0; c < g.n; c++)
      if (!g.fn[r * g.n + c] && mask_bit(mask, r, c)) g.m[r * g.n + c] ^= 1;
}

// Format information: level L (01) and the mask, BCH(15,5), masked 0x5412.
inline void put_format(Grid &g, int mask) {
  int data = (1 << 3) | mask, rem = data;
  for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  int bits = ((data << 10) | rem) ^ 0x5412;
  auto bit = [&](int i) { return ((bits >> i) & 1) != 0; };
  int n = g.n;
  for (int i = 0; i <= 5; i++) g.put(8, i, bit(i));
  g.put(8, 7, bit(6));
  g.put(8, 8, bit(7));
  g.put(7, 8, bit(8));
  for (int i = 9; i < 15; i++) g.put(14 - i, 8, bit(i));
  for (int i = 0; i < 8; i++) g.put(n - 1 - i, 8, bit(i));
  for (int i = 8; i < 15; i++) g.put(8, n - 15 + i, bit(i));
  g.put(8, n - 8, true);  // always dark
}

// The four penalty rules, as qrcode's mask-pattern.js counts them.
inline long penalty(const Grid &g) {
  int n = g.n;
  auto at = [&](int r, int c) { return (int)g.m[r * n + c]; };
  long p = 0;
  // 1: runs of five or more in a row or column.
  for (int a = 0; a < n; a++) {
    int same_c = 0, same_r = 0, last_c = -1, last_r = -1;
    for (int b = 0; b < n; b++) {
      int v = at(a, b);
      if (v == last_c) same_c++;
      else {
        if (same_c >= 5) p += 3 + (same_c - 5);
        last_c = v;
        same_c = 1;
      }
      v = at(b, a);
      if (v == last_r) same_r++;
      else {
        if (same_r >= 5) p += 3 + (same_r - 5);
        last_r = v;
        same_r = 1;
      }
    }
    if (same_c >= 5) p += 3 + (same_c - 5);
    if (same_r >= 5) p += 3 + (same_r - 5);
  }
  // 2: 2x2 blocks of one color.
  for (int r = 0; r < n - 1; r++)
    for (int c = 0; c < n - 1; c++) {
      int s = at(r, c) + at(r, c + 1) + at(r + 1, c) + at(r + 1, c + 1);
      if (s == 4 || s == 0) p += 3;
    }
  // 3: finder-like runs (1:1:3:1:1 with four light modules on one side).
  for (int a = 0; a < n; a++) {
    int bits_c = 0, bits_r = 0;
    for (int b = 0; b < n; b++) {
      bits_c = ((bits_c << 1) & 0x7FF) | at(a, b);
      if (b >= 10 && (bits_c == 0x5D0 || bits_c == 0x05D)) p += 40;
      bits_r = ((bits_r << 1) & 0x7FF) | at(b, a);
      if (b >= 10 && (bits_r == 0x5D0 || bits_r == 0x05D)) p += 40;
    }
  }
  // 4: how far the dark share is from half.
  int dark = 0;
  for (int i = 0; i < n * n; i++) dark += g.m[i];
  int k = (dark * 100 * 2 + n * n * 10 - 1) / (n * n * 10);  // ceil((dark * 100 / total) / 5), in integers
  p += (k > 10 ? k - 10 : 10 - k) * 10;
  return p;
}

}  // namespace detail

// False when the text doesn't fit a version 3 code (over MAX_TEXT bytes).
inline bool encode(const std::string &text, Code &out) {
  using namespace detail;
  static const int DATA[] = {19, 34, 55}, EC[] = {7, 10, 15};
  int ver = 0;
  while (ver < 3 && (int)text.size() > DATA[ver] - 2) ver++;
  if (ver == 3) return false;
  int nd = DATA[ver], ne = EC[ver], n = 21 + 4 * ver;

  // Codewords: mode 0100, the length, the bytes, a terminator, then padding.
  uint8_t cw[55 + 15];
  memset(cw, 0, sizeof cw);
  int nbits = 0;
  auto push = [&](int v, int len) {
    for (int i = len - 1; i >= 0; i--, nbits++)
      if ((v >> i) & 1) cw[nbits >> 3] |= (uint8_t)(0x80 >> (nbits & 7));
  };
  push(4, 4);
  push((int)text.size(), 8);
  for (unsigned char ch : text) push(ch, 8);
  push(0, nd * 8 - nbits < 4 ? nd * 8 - nbits : 4);
  nbits = (nbits + 7) / 8 * 8;
  for (int pad = 0xEC; nbits < nd * 8; pad ^= 0xEC ^ 0x11) push(pad, 8);

  // Reed-Solomon: the remainder of the data by the generator polynomial.
  uint8_t gen[15];
  memset(gen, 0, sizeof gen);
  gen[ne - 1] = 1;
  uint8_t root = 1;
  for (int i = 0; i < ne; i++) {
    for (int j = 0; j < ne; j++) {
      gen[j] = gf_mul(gen[j], root);
      if (j + 1 < ne) gen[j] ^= gen[j + 1];
    }
    root = gf_mul(root, 2);
  }
  uint8_t *ecw = cw + nd;
  for (int i = 0; i < nd; i++) {
    uint8_t factor = cw[i] ^ ecw[0];
    memmove(ecw, ecw + 1, (size_t)ne - 1);
    ecw[ne - 1] = 0;
    for (int j = 0; j < ne; j++) ecw[j] ^= gf_mul(gen[j], factor);
  }

  // Function patterns: timing, the three finders with their separators, the
  // alignment pattern (versions 2 and 3), and room for the format bits.
  Grid g;
  g.n = n;
  memset(g.m, 0, sizeof g.m);
  memset(g.fn, 0, sizeof g.fn);
  for (int i = 0; i < n; i++) {
    g.put(6, i, i % 2 == 0);
    g.put(i, 6, i % 2 == 0);
  }
  const int fx[] = {3, n - 4, 3}, fy[] = {3, 3, n - 4};
  for (int k = 0; k < 3; k++)
    for (int dy = -4; dy <= 4; dy++)
      for (int dx = -4; dx <= 4; dx++) {
        int d = (dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy) ? (dx < 0 ? -dx : dx) : (dy < 0 ? -dy : dy);
        g.put(fx[k] + dx, fy[k] + dy, d != 2 && d != 4);
      }
  if (ver > 0)
    for (int dy = -2; dy <= 2; dy++)
      for (int dx = -2; dx <= 2; dx++) {
        int d = (dx < 0 ? -dx : dx) > (dy < 0 ? -dy : dy) ? (dx < 0 ? -dx : dx) : (dy < 0 ? -dy : dy);
        g.put(n - 7 + dx, n - 7 + dy, d != 1);
      }
  put_format(g, 0);

  // Data and error correction bits, zigzagging up and down in column pairs
  // from the right, skipping the timing column.
  int total = (nd + ne) * 8, i = 0;
  for (int right = n - 1; right >= 1; right -= 2) {
    if (right == 6) right = 5;
    for (int vert = 0; vert < n; vert++)
      for (int j = 0; j < 2; j++) {
        int x = right - j;
        bool upward = ((right + 1) & 2) == 0;
        int y = upward ? n - 1 - vert : vert;
        if (g.fn[y * n + x]) continue;
        if (i < total) g.m[y * n + x] = (cw[i >> 3] >> (7 - (i & 7))) & 1;
        i++;
      }
  }

  int best = 0;
  long best_p = -1;
  for (int mask = 0; mask < 8; mask++) {
    put_format(g, mask);
    apply_mask(g, mask);
    long p = penalty(g);
    if (best_p < 0 || p < best_p) {
      best_p = p;
      best = mask;
    }
    apply_mask(g, mask);  // undo
  }
  put_format(g, best);
  apply_mask(g, best);
  out.n = n;
  memcpy(out.m, g.m, (size_t)n * n);
  return true;
}

}  // namespace qr
