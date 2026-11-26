// Prints the QR code qr.h makes for each argument: one line per code, the
// side then the modules as 0/1 (row by row), or "none" when the text doesn't
// fit. tests/qr.test.js compares them with the qrcode package's.
#include <stdio.h>

#include "../ctaboard/src/qr.h"

int main(int argc, char **argv) {
  for (int a = 1; a < argc; a++) {
    qr::Code c;
    if (!qr::encode(argv[a], c)) {
      printf("none\n");
      continue;
    }
    printf("%d ", c.n);
    for (int y = 0; y < c.n; y++)
      for (int x = 0; x < c.n; x++) putchar(c.dark(x, y) ? '1' : '0');
    putchar('\n');
  }
  return 0;
}
