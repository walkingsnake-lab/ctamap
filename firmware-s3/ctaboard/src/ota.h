// Over-the-air updates: the trial rules. Plain C++ (no Arduino headers), so
// firmware-s3/tests checks them natively; device.cpp keeps the state in
// flash (NVS) and does the flash writes.
//
// The server offers a build in /board/version (`fw`, contract). The board
// downloads it into the unused app slot, checks its SHA-256, and restarts
// into it. The new build is on trial until it proves itself:
//   - kept once it has had a good /board/update and run KEEP_AFTER_MS;
//   - rolled back (restart into the previous slot) if it hasn't reached the
//     server within GIVE_UP_MS, or if it restarts more than MAX_TRIAL_BOOTS
//     times (a crash loop) before it's kept.
// A rolled-back offer is marked bad (`mark`), and the board doesn't install
// it again until the server's retry count for it changes (the control
// page's "Try again").
#pragma once

#include <string>

namespace ota {

const int MAX_TRIAL_BOOTS = 3;
const long long KEEP_AFTER_MS = 60000;
const long long GIVE_UP_MS = 300000;
const long long RETRY_MS = 600000;      // after a failed download or install
const long long WAIT_FOR_GAP_MS = 120000;  // install in an animation gap, or after waiting this long

struct State {
  std::string trial;  // the build on trial ("" when none)
  std::string prev;   // the app slot to roll back to (partition label)
  int boots = 0;      // starts of the trial build so far
  long retry = 0;     // the offer's retry count, for its bad mark
  std::string bad;    // mark() of the last rolled-back offer
};

// An offer's identity for the bad mark: version plus the server's retry count.
inline std::string mark(const std::string &v, long retry) { return v + "_" + std::to_string(retry); }

enum BootAction { RUN, ROLL_BACK };

// At startup, before anything that could crash. `running` is this build's
// version. A trial left over from a different build (a USB flash replaced
// it) is dropped.
inline BootAction on_boot(State &s, const std::string &running) {
  if (s.trial.empty()) return RUN;
  if (s.trial != running) {
    s.trial.clear();
    s.prev.clear();
    s.boots = 0;
    return RUN;
  }
  s.boots++;
  return s.boots > MAX_TRIAL_BOOTS ? ROLL_BACK : RUN;
}

// After a rollback: the trial ends and its offer is marked bad.
inline void rolled_back(State &s) {
  s.bad = mark(s.trial, s.retry);
  s.trial.clear();
  s.prev.clear();
  s.boots = 0;
}

// The trial build proved itself.
inline void kept(State &s) {
  s.trial.clear();
  s.prev.clear();
  s.boots = 0;
}

}  // namespace ota
