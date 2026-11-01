// Reads settings JSON (a file) with config::from_json and prints them back
// with config::to_json: setup-board.test.js checks that what
// scripts/setup-board.js writes survives the firmware's reader unchanged.
//   config_roundtrip <cfg.json>

#include <stdio.h>

#include <fstream>
#include <sstream>
#include <string>

#include "../ctaboard/src/config.h"

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  std::ifstream in(argv[1], std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  config::Config c;
  std::string err;
  if (!config::from_json(ss.str(), c, &err)) {
    printf("from_json failed: %s\n", err.c_str());
    return 1;
  }
  fputs(config::to_json(c).c_str(), stdout);
  return 0;
}
