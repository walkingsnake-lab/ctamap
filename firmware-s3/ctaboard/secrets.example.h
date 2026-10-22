// Board settings. Copy this file to secrets.h (same folder) and fill it in.
// secrets.h is never committed (.gitignore).

#pragma once

// WiFi networks, tried in order; networks the board can see go first.
// Put the phone hotspot last.
#define WIFI_NETWORKS                \
  {                                  \
    {"home-network", "password"},    \
    {"work-visitor", "password"},    \
    {"Jake's iPhone", "password"},   \
  }

#define BOARD_URL "https://ctamap.fly.dev"
#define BOARD_ID "home"
// Same value as the BOARD_TOKEN Fly secret.
#define BOARD_TOKEN "..."

// 0, or 180 when the panel is mounted upside down. The UP/DOWN buttons keep
// their screen order.
#define MATRIX_ROTATION 0

// Panel clock edge: 0 = falling, 1 = rising (the driver's default). The wrong
// one for a panel shifts the picture a pixel and shows stray pixels; the
// default shifted this P3 panel 1 px left, so this is 0. Try 1 if yours is off.
#define MATRIX_CLK_PHASE 0

// Draw each frame into a back buffer and flip it in (1), or draw straight
// onto the panel (0). Try 0 if frames still glitch with the clock edge right.
#define MATRIX_DOUBLE_BUFFER 1

// Extra gamma on top of the panel driver's own brightness curve. 1.0 = none
// (the driver's curve is usually right). Try 1.2 if dim colors look washed out.
#define MATRIX_GAMMA 1.0

// Status NeoPixel (behind the panel): 2 = every state, including blue during
// each request; 1 = errors and connecting only; 0 = always off.
#define STATUS_LED 2

// Verify the server's HTTPS certificate against the roots in src/certs.h.
// Leave on; set to 0 only to rule certificates out while troubleshooting.
#define TLS_VERIFY 1
