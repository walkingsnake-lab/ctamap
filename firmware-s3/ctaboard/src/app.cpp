// Port of firmware/boardlib/app.py (Board); see app.h. MemoryError handling
// is gone: the S3 has PSRAM and C++ doesn't fragment the heap the way
// CircuitPython's collector did.

#include "app.h"

#include <stdio.h>

#include <algorithm>

namespace app {

// Status LED while connecting, by status screen (draw::render_status).
static std::string led_for_status(const std::string &kind) {
  if (kind == "portal") return "portal";
  if (kind == "nowifi" || kind == "noserver") return "offline";
  return "connecting";  // connecting, ok
}

Board::Board(Net *n, Display *d, Clock *c, Networks nets, Buttons *b, Watchdog *w,
             std::function<void(const std::string &)> lg, std::string st, std::string cr, Led *l)
    : net(n), display(d), clock(c), networks(std::move(nets)), buttons(b), watchdog(w), led(l), log(std::move(lg)),
      version_job("version", VERSION_EVERY, 20000, [this](double ms) { return do_version(ms); }),
      update_job("update", UPDATE_EVERY, 30000, [this](double ms) { return do_update(ms); }),
      radar_job("radar", RADAR_EVERY, 120000, [this](double ms) { return do_radar(ms); }),
      logo_job("logo", LOGO_EVERY, 120000, [this](double ms) { return do_logo(ms); }),
      started(std::move(st)), crash(std::move(cr)) {
  sched.add(&version_job);
  sched.add(&update_job);
  sched.add(&radar_job);
  sched.add(&logo_job);
  // Uptime counts from this run.
  run_start_ = clock->ms();
}

// ---- time ----
// The server's whole-second `now` puts the true time at `ended` between lo
// and hi. The clock starts at lo and moves only when it's outside that
// range, to its nearest edge: forward as better samples come in, back only
// if the board's own clock runs fast.

void Board::sync(double server_now, long long started_ms, long long ended) {
  long long lo = (long long)server_now * 1000;
  long long hi = lo + 1000 + (ended - started_ms);
  long long t = synced ? now_ms(ended) : lo;
  synced = true;
  epoch_ms = std::min(std::max(t, lo), hi);
  sync_ms = ended;
}

// ---- connecting ----

void Board::status(const std::string &kind, const std::string &detail) {
  if (watchdog) watchdog->feed();
  if (on_status) on_status(kind);
  led_base = led_for_status(kind);
  if (led) led->set(led_base);
  display->show([&](draw::Frame &f) { draw::render_status(f, kind, detail); });
}

void Board::connect(bool boot) {
  // Blocks until online: tries each network, shows status screens, retries
  // after 10, 20, 30 s, then every minute. Then fetches an update; boot=1
  // only after a real restart (it resets the phone's brightness override).
  int round = 0;
  while (true) {
    ConnectResult cr = net->connect(networks, [this](const std::string &k, const std::string &d) { status(k, d); });
    if (cr.result == "ok") {
      status("ok", cr.detail);
      long long st = clock->ms();
      Value p;
      std::string err;
      if (net->update(boot, "", p, err)) {
        long long ms = clock->ms();
        apply(p, st, ms);
        update_job.due_at = (double)(ms + (long long)update_job.interval_ms);
        version_job.due_at = (double)(ms + VERSION_EVERY);
        online = true;
        fails = 0;
        led_base = "ok";
        led_update();
        return;
      }
      say("[board] first update failed: " + err);
      status("noserver");
    } else {
      status(cr.result, cr.result == "portal" ? cr.detail : "");
    }
    wait(RETRY_WIFI_MS[std::min(round, 3)]);
    round++;
  }
}

void Board::wait(long long ms_total) {
  long long end = clock->ms() + ms_total;
  while (clock->ms() < end) {
    if (watchdog) watchdog->feed();
    clock->sleep_ms(std::min(1000LL, end - clock->ms()));
  }
}

// ---- jobs ----

void Board::apply(const Value &p, long long st, long long ms) {
  sync(p["now"].num(), st, ms);
  player.set_payload(p, (double)ms);
  player.set_screen(override_.resolve(player.auto_screen(now(ms)), json::str(p["v"])), (double)ms);
  update_job.interval_ms = (double)(player.live_game() ? LIVE_EVERY : UPDATE_EVERY);
}

bool Board::draw_frame(long long ms, long long n) {
  display->show([&](draw::Frame &f) { player.draw(f, (double)ms, n); });
  return true;
}

std::string Board::health_query(long long ms) {
  // Health fields for the version check (contract: /board/version), rebuilt
  // at most once a minute.
  if (!health_at_ || ms - *health_at_ >= HEALTH_EVERY) {
    health_at_ = ms;
    char buf[160];
    snprintf(buf, sizeof buf, "&hu=%lld&hb=%lld&ho=0&hf=%ld&hr=%ld", (ms - run_start_) / 1000,
             (long long)sched.budget_ms, stats.fails, stats.reconnects);
    std::string q = buf;
    if (mem_free) q += "&hm=" + std::to_string(mem_free());
    if (largest_block) q += "&hl=" + std::to_string(largest_block());
    int rssi;
    if (net->rssi(rssi)) q += "&hw=" + std::to_string(rssi);
    if (!last_error.empty()) q += "&he=" + last_error;
    if (!started.empty()) q += "&hs=" + started;
    if (!crash.empty()) q += "&hc=" + crash;
    health_q_ = q;
  }
  return health_q_;
}

sched::Result Board::do_version(double ms) {
  fetching();
  Value r;
  if (!net->version(health_query((long long)ms), r, job_err_)) return sched::FAIL;
  sync(r["now"].num(), (long long)ms, clock->ms());
  if (!player.has_p || json::str(r["v"]) != json::str(player.p["v"])) update_job.due_at = 0;  // settings changed: fetch now
  return sched::OK;
}

sched::Result Board::do_update(double ms) {
  // The server sends only the shown screen's sections; while a button press
  // overrides the screen, ask for that one.
  fetching();
  Value p;
  if (!net->update(false, override_.screen ? *override_.screen : "", p, job_err_)) return sched::FAIL;
  apply(p, (long long)ms, clock->ms());
  return sched::OK;
}

sched::Result Board::do_logo(double ms) {
  // Team logos (24 x 12, immutable ids) for the baseball logo layout: the
  // game on screen and the next one.
  std::vector<std::string> missing = player.missing_logos(now((long long)ms));
  if (missing.empty() || !player.has_logo_slot()) return sched::SKIP;
  fetching();
  std::vector<uint8_t> buf;
  if (!net->logo(missing[0], buf, job_err_)) return sched::FAIL;
  player.add_logo(missing[0], std::move(buf));
  return missing.size() > 1 ? sched::MORE : sched::OK;
}

sched::Result Board::do_radar(double) {
  // Frames are only needed on the radar screen or ahead of a visit.
  if (!player.wants_frames()) return sched::SKIP;
  std::vector<std::string> missing = player.missing_frames();
  if (missing.empty() || !player.has_slot()) return sched::SKIP;
  fetching();
  std::vector<uint8_t> buf;
  if (!net->radar(missing[0], buf, job_err_)) return sched::FAIL;
  player.add_frame(missing[0], std::move(buf), (double)clock->ms());
  return missing.size() > 1 ? sched::MORE : sched::OK;
}

// ---- loop ----

void Board::step() {
  // Buttons, at most one network job, and a redraw when something on screen
  // can have changed.
  long long ms = clock->ms();
  if (watchdog) watchdog->feed();
  do_buttons(ms);

  long long n = now(ms);
  if (player.has_p) {
    // Timed radar visits: follow the server's schedule unless a button
    // press is overriding it.
    player.set_screen(override_.resolve(player.auto_screen(n), json::str(player.p["v"])), (double)ms);
  }
  if (fails == 0 && player.awaiting_drop(n)) {
    // A train is due to drop but the payload is older than that moment:
    // fetch now rather than drop it on stale data.
    sched.due_now(&update_job, (double)ms);
  }
  bool busy = player.busy((double)ms);
  double quiet = std::max(0.0, player.quiet_ms((double)ms, n) - (double)draw::fmod_floor(now_ms(ms), 1000));
  sched::Job *job = sched.pick((double)ms, busy, quiet);
  if (job && !job->overdue((double)ms) && !player.at_blink_start((double)ms)) job = nullptr;  // wait for the blink to turn on
  if (job) {
    if (player.blinking()) {
      // Show the lit frame now; the pause will hold it.
      draw_frame(ms, n);
      last_draw_ = ms;
    }
    long long st = clock->ms();
    job_err_.clear();
    sched::Result result = job->run((double)st);
    if (result == sched::OK || result == sched::MORE) {
      fails = 0;  // a skipped job proves nothing about the network
      led_base = "ok";
    } else if (result == sched::FAIL) {
      std::string reason = job_err_.empty() ? "Error" : job_err_;
      say("[board] " + job->name + " failed: " + reason);
      stats.fails++;
      last_error = job->name + ":" + reason;
      fails++;
      led_base = "failing";
    }
    long long ended = clock->ms();
    if (player.blinking() && ended - st > 300) player.blink_restart((double)ended);
    if (result == sched::SKIP) {
      job->due_at = (double)ended + job->interval_ms;
    } else {
      stats.fetches++;
      if (job->overdue((double)st) && (busy || quiet < sched.budget_ms)) stats.forced++;
      sched.ran(job, (double)st, (double)ended, result != sched::FAIL);
      if (result == sched::MORE) {
        // More of a set to fetch (radar frames, logos). While that screen is
        // showing, go again right away; while prefetching, take the next gap.
        bool showing = player.screen == (job == &radar_job ? "weather" : "baseball");
        job->due_at = showing ? (double)ended - job->deadline_ms : (double)ended;
      }
    }
    if (fails >= FAILS_BEFORE_RECONNECT) {
      say("[board] " + std::to_string(fails) + " failures in a row; reconnecting");
      online = false;
      fails = 0;
      stats.reconnects++;
      connect(false);
    }
    ms = clock->ms();
  }
  led_update();

  // Redraw every ~33 ms while animating; otherwise only when something on
  // screen can have changed.
  n = now(ms);
  std::optional<std::string> key = player.frame_key((double)ms, n);
  if (last_draw_ < 0 || (!key ? ms - last_draw_ >= 33 : key != last_key_)) {
    if (draw_frame(ms, n)) {
      last_draw_ = ms;
      last_key_ = key;
      stats.draws++;
    }
  }
}

void Board::fetching() {
  // Blue while a request blocks the loop; step() sets the LED back after.
  if (led) led->set("fetch");
}

void Board::led_update() {
  if (led) led->set(led_base == "ok" ? "off" : led_base);
}

void Board::do_buttons(long long ms) {
  if (!buttons || !player.has_p) return;
  int stp = 0;
  if (up_.update(buttons->up(), (double)ms)) stp = -1;
  if (down_.update(buttons->down(), (double)ms)) stp = 1;
  if (stp) {
    std::string s = override_.press(stp, player.screen, json::str(player.p["v"]));
    player.set_screen(s, (double)ms);
    radar_job.due_at = 0;
    // The payload only has the old screen's data: fetch the new one now.
    update_job.due_at = (double)ms - update_job.deadline_ms;
  }
}

}  // namespace app
