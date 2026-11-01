// Port of firmware/boardlib/app.py (Board); see app.h. MemoryError handling
// is gone: the S3 has PSRAM and C++ doesn't fragment the heap the way
// CircuitPython's collector did.

#include "app.h"

#include <stdio.h>

#include <string.h>

#include <algorithm>

namespace app {

// Status LED while connecting, by status screen (draw::render_status).
static std::string led_for_status(const std::string &kind) {
  if (kind == "portal") return "portal";
  if (kind == "nowifi" || kind == "noserver") return "offline";
  if (kind == "updating") return "fetch";
  return "connecting";  // connecting, ok
}

Board::Board(Net *n, Display *d, Clock *c, Networks nets, Buttons *b, Watchdog *w,
             std::function<void(const std::string &)> lg, std::string st, std::string cr, Led *l, Knob *k)
    : net(n), display(d), clock(c), networks(std::move(nets)), buttons(b), watchdog(w), led(l), knob(k), log(std::move(lg)),
      version_job("version", VERSION_EVERY, 20000, [this](double ms) { return do_version(ms); }),
      update_job("update", UPDATE_EVERY, 30000, [this](double ms) { return do_update(ms); }),
      radar_job("radar", RADAR_EVERY, 120000, [this](double ms) { return do_radar(ms); }),
      logo_job("logo", LOGO_EVERY, 120000, [this](double ms) { return do_logo(ms); }),
      sky_job("sky", SKY_EVERY, 60000, [this](double ms) { return do_sky(ms); }),
      started(std::move(st)), crash(std::move(cr)) {
  sched.add(&version_job);
  sched.add(&update_job);
  sched.add(&radar_job);
  sched.add(&logo_job);
  sched.add(&sky_job);
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
  long long ms = clock->ms();
  display->show([&](draw::Frame &f) {
    draw::render_status(f, kind, detail);
    shown("status", f, ms);
  });
}

void Board::connect(bool boot) {
  // Blocks until online: tries each network, shows status screens, retries
  // after 10, 20, 30 s, then every minute. Then fetches an update; boot=1
  // only after a real restart (it resets the phone's brightness override).
  // WiFi setup: with no networks saved, the setup network opens right away;
  // after a network entered on the setup page fails once, or none has
  // joined for SETUP_AFTER_MS, it opens again (a new router or password).
  // noserver doesn't count: WiFi works, the server is down.
  int round = 0;
  std::optional<long long> offline_since;
  while (true) {
    if (setup && networks.empty()) setup->run("nowifi");
    ConnectResult cr = net->connect(networks, [this](const std::string &k, const std::string &d) { status(k, d); });
    if (cr.result != "ok") {
      long long t = clock->ms();
      if (!offline_since) offline_since = t;
      if (setup && fresh_wifi) {
        fresh_wifi = false;
        say("[setup] the new network didn't join; reopening setup");
        setup->run("badwifi");
      } else if (setup && t - *offline_since >= SETUP_AFTER_MS) {
        say("[setup] no network joined for " + std::to_string((t - *offline_since) / 60000) + " min; opening setup");
        offline_since.reset();
        setup->run("nowifi");
      }
    } else {
      offline_since.reset();
      // The new network is first in the list: it worked only if it's the one joined.
      if (fresh_wifi && setup) {
        if (!networks.empty() && cr.detail == networks[0].first) setup->joined();
        else say("[setup] the new network didn't join; online on " + cr.detail);
      }
      fresh_wifi = false;
    }
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
        reached_server = true;
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
    trial_check(clock->ms());
    wait(RETRY_WIFI_MS[std::min(round, 3)]);
    round++;
  }
}

void Board::wait(long long ms_total) {
  long long end = clock->ms() + ms_total;
  while (clock->ms() < end) {
    if (watchdog) watchdog->feed();
    trial_check(clock->ms());
    clock->sleep_ms(std::min(1000LL, end - clock->ms()));
  }
}

// ---- jobs ----

void Board::apply(const Value &p, long long st, long long ms) {
  sync(p["now"].num(), st, ms);
  player.set_payload(p, (double)ms);
  double b = p["bright"].is_null() ? 100 : p["bright"].num();
  payload_bright_ = std::max(0.0, std::min(100.0, b));
  const Value &ab = p["ab"];
  ab_min_.reset();
  if (ab.is_obj() && ab["min"].is_num()) ab_min_ = std::max(0.0, std::min(100.0, ab["min"].num()));
  apply_bright(ms);
  player.set_screen(override_.resolve(player.auto_screen(now(ms)), json::str(p["v"])), (double)ms);
  update_job.interval_ms = (double)(player.live_game() ? LIVE_EVERY : UPDATE_EVERY);
  if (player.missing_cloud()) sky_job.due_at = 0;  // a new sky: fetch its clouds in the next gap
}

// Screens in the order they slide: a later one comes in from the right,
// an earlier one from the left (the knob ring's order).
static int screen_order(const std::string &s) {
  static const char *const ORDER[] = {"transit", "ticker", "weather", "baseball", "clock"};
  for (int i = 0; i < 5; i++)
    if (s == ORDER[i]) return i;
  return -1;
}

void Board::shown(const std::string &what, const draw::Frame &f, long long ms) {
  // A different screen than the last frame's: slide it in over that frame
  // (spec §2, "Screen change"). The first frame ever, status screens, and
  // the knob's chooser (a turn should answer at once) just appear; leaving
  // them slides. Leaving the chooser follows the knob's turn.
  if (what != shown_ && !shown_.empty() && what != "status" && what != "chooser") {
    memcpy(slide_px_, last_px_, sizeof slide_px_);
    slide_start_ = ms;
    if (shown_ == "chooser") slide_dir_ = chooser_travel_ < 0 ? -1 : 1;
    else slide_dir_ = screen_order(what) < screen_order(shown_) ? -1 : 1;
  }
  shown_ = what;
  memcpy(last_px_, f.px, sizeof last_px_);
}

bool Board::draw_frame(long long ms, long long n) {
  std::string what = chooser.open ? "chooser" : player.screen;
  if (chooser.open) chooser_travel_ = chooser.target - chooser.start;
  player.wall_ms = (double)now_ms(ms);  // the skyline's animation clock
  display->show([&](draw::Frame &f) {
    if (chooser.open) {
      draw::RenderOpts o;
      o.screen = "chooser";
      o.chooser_pos = chooser.pos((double)ms);
      o.chooser_commit = chooser.committing;
      o.apply_bright = !player.hw_bright;
      o.bright = player.bright;
      draw::render(player.p, f, o);
    } else {
      player.draw(f, (double)ms, n);
    }
    // shown() keeps this frame's own pixels for the next change (and starts
    // a slide, which begins on the old frame: t = 0); then the slide.
    shown(what, f, ms);
    if (sliding(ms)) draw::slide_frames(slide_px_, f, draw::slide_offset((double)(ms - slide_start_)), slide_dir_);
  });
  return true;
}

std::string Board::health_query(long long ms) {
  // Health fields for the version check (contract: /board/version), rebuilt
  // at most once a minute (the light reading excepted).
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
    if (!hardware.empty()) q += "&hd=" + hardware;
    if (!firmware.empty()) q += "&hv=" + firmware;
    q += std::string("&hk=") + CAPS;
    std::string ox = ota_health();
    if (!ox.empty()) q += "&hx=" + ox;
    health_q_ = q;
  }
  // The light sensor's reading rides on every check (every ~10 s), fresh,
  // so the phone can be used to tune it.
  if (light && sense_.live(ms)) {
    char lx[24];
    snprintf(lx, sizeof lx, "&ha=%.3g", sense_.lux());
    return health_q_ + lx;
  }
  return health_q_;
}

// Jobs run in two halves. The first (here, on the loop) decides what to ask
// for and launches a Flight; its work() makes the request (on the worker, or
// inline without one) and touches only the Flight; finish() applies the
// answer back on the loop.

sched::Result Board::do_version(double ms) {
  Flight f;
  std::string h = health_query((long long)ms);
  f.work = [this, h] { return net->version(h, flight_->v, flight_->err); };
  f.finish = [this](long long ended) {
    const Value &r = flight_->v;
    sync(r["now"].num(), flight_->started, ended);
    // An OTA offer (contract: /board/version `fw`); absent when there's nothing to install.
    const Value &fw = r["fw"];
    if (fw.is_obj() && fw["v"].is_str() && fw["size"].num() > 0 && fw["sha"].is_str()) {
      FirmwareOffer o;
      o.v = fw["v"].s;
      o.size = (long long)fw["size"].num();
      o.sha = fw["sha"].s;
      o.retry = (long)fw["n"].num(0);
      o.sig = fw["sig"].str_or("");
      offer = o;
    } else {
      offer.reset();
    }
    if (!player.has_p || json::str(r["v"]) != json::str(player.p["v"])) update_job.due_at = 0;  // settings changed: fetch now
    return sched::OK;
  };
  launch(std::move(f));
  return sched::STARTED;
}

sched::Result Board::do_update(double) {
  // The server sends only the shown screen's sections; while a button press
  // overrides the screen, ask for that one.
  Flight f;
  std::string scr = override_.screen ? *override_.screen : "";
  f.work = [this, scr] { return net->update(false, scr, flight_->v, flight_->err); };
  f.finish = [this](long long ended) {
    apply(flight_->v, flight_->started, ended);
    reached_server = true;
    return sched::OK;
  };
  launch(std::move(f));
  return sched::STARTED;
}

sched::Result Board::do_logo(double ms) {
  // Team logos (24 x 12, immutable ids) for the baseball logo layout: the
  // game on screen and the next one.
  std::vector<std::string> missing = player.missing_logos(now((long long)ms));
  if (missing.empty() || !player.has_logo_slot()) return sched::SKIP;
  Flight f;
  f.id = missing[0];
  f.left = (int)missing.size() - 1;
  f.work = [this] { return net->logo(flight_->id, flight_->bytes, flight_->err); };
  f.finish = [this](long long) {
    player.add_logo(flight_->id, std::move(flight_->bytes));
    return flight_->left > 0 ? sched::MORE : sched::OK;
  };
  launch(std::move(f));
  return sched::STARTED;
}

sched::Result Board::do_sky(double) {
  // The skyline's cloud strip (1664 bytes, immutable id), while the clock
  // screen shows and the payload names one not on hand.
  std::optional<std::string> id = player.missing_cloud();
  if (!id) return sched::SKIP;
  Flight f;
  f.id = *id;
  f.work = [this] {
    if (!net->sky(flight_->id, flight_->bytes, flight_->err)) return false;
    if (flight_->bytes.size() != 1664) {
      flight_->err = "BadSize";
      return false;
    }
    return true;
  };
  f.finish = [this](long long) {
    // The payload may have moved on while the strip was on its way.
    std::optional<std::string> still = player.missing_cloud();
    if (still && *still == flight_->id) player.add_cloud(flight_->id, std::move(flight_->bytes));
    return sched::OK;
  };
  launch(std::move(f));
  return sched::STARTED;
}

sched::Result Board::do_radar(double) {
  // Frames are only needed on the radar screen or ahead of a visit.
  if (!player.wants_frames()) return sched::SKIP;
  std::vector<std::string> missing = player.missing_frames();
  if (missing.empty() || !player.has_slot()) return sched::SKIP;
  Flight f;
  f.id = missing[0];
  f.left = (int)missing.size() - 1;
  f.work = [this] { return net->radar(flight_->id, flight_->bytes, flight_->err); };
  f.finish = [this](long long ended) {
    // The payload may have moved on while the frame was on its way.
    if (player.wants_frames()) {
      std::vector<std::string> still = player.missing_frames();
      if (std::find(still.begin(), still.end(), flight_->id) != still.end() && player.has_slot())
        player.add_frame(flight_->id, std::move(flight_->bytes), (double)ended);
    }
    return flight_->left > 0 ? sched::MORE : sched::OK;
  };
  launch(std::move(f));
  return sched::STARTED;
}

void Board::launch(Flight f) {
  f.job = pending_job_;  // null: the knob's select
  f.started = pending_job_ ? pending_start_ : clock->ms();
  f.forced = pending_job_ && pending_forced_;
  flight_ = std::move(f);
  fetching();
  if (worker) {
    worker->start([this] { flight_->ok = flight_->work(); });
    return;
  }
  // No worker: the request blocks the loop here, as on the M4.
  flight_->ok = flight_->work();
  land(clock->ms());
}

void Board::land(long long ended) {
  // The request is back: finish it on the loop. flight_ stays set while
  // finish() reads it.
  Flight &f = *flight_;
  if (f.job) {
    sched::Result r = f.ok ? f.finish(ended) : sched::FAIL;
    if (r == sched::FAIL) job_err_ = f.err;
    after_job(f, r, ended);
    flight_.reset();
    if (fails >= FAILS_BEFORE_RECONNECT) {
      say("[board] " + std::to_string(fails) + " failures in a row; reconnecting");
      online = false;
      fails = 0;
      stats.reconnects++;
      connect(false);
    }
  } else {
    after_select(f, ended);
    flight_.reset();
  }
  led_update();
}

sched::Result Board::after_job(Flight &f, sched::Result result, long long ended) {
  sched::Job *job = f.job;
  long long st = f.started;
  if (result == sched::OK || result == sched::MORE) {
    fails = 0;
    led_base = "ok";
  } else {
    std::string reason = job_err_.empty() ? "Error" : job_err_;
    say("[board] " + job->name + " failed: " + reason);
    stats.fails++;
    last_error = job->name + ":" + reason;
    fails++;
    led_base = "failing";
  }
  // Blocking only: a long pause froze the blink; restart it off so the
  // pause reads as one long "on".
  if (!worker && player.blinking() && ended - st > 300) player.blink_restart((double)ended);
  stats.fetches++;
  if (f.forced) stats.forced++;
  sched.ran(job, (double)st, (double)ended, result != sched::FAIL);
  if (result == sched::MORE) {
    // More of a set to fetch (radar frames, logos). While that screen is
    // showing, go again right away; while prefetching, take the next gap.
    bool showing = player.screen == (job == &radar_job ? "weather" : "baseball");
    job->due_at = showing ? (double)ended - job->deadline_ms : (double)ended;
  }
  return result;
}

// ---- loop ----

void Board::step() {
  // Buttons, at most one network job, and a redraw when something on screen
  // can have changed.
  long long ms = clock->ms();
  // A request that never comes back (a hung TLS read on the worker) would
  // leave the board showing old data forever: stop feeding the watchdog,
  // and it restarts the board.
  bool stuck = flight_ && ms - flight_->started >= WORK_STUCK_MS;
  if (watchdog && !stuck) watchdog->feed();
  if (stuck && !stuck_said_) {
    stuck_said_ = true;
    say("[board] a request has run " + std::to_string((ms - flight_->started) / 1000) + " s; letting the watchdog restart");
  }
  if (flight_ && worker && worker->done()) {
    land(clock->ms());
    ms = clock->ms();
  }
  do_buttons(ms);
  do_knob(ms);
  if (chooser.rested((double)ms) && !flight_) {
    commit_choice(ms);
    ms = clock->ms();
  }

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
  bool anim = player.busy((double)ms) || sliding(ms);
  if (!flight_) {
    // While the chooser is open only overdue requests run, so the commit
    // goes out the moment the knob rests. Without a worker a request also
    // freezes the panel, so it waits for an animation gap.
    bool busy = worker ? chooser.open : anim || chooser.open;
    double quiet = chooser.open ? 0.0
                   : worker     ? 1e18
                                : std::max(0.0, player.quiet_ms((double)ms, n) - (double)draw::fmod_floor(now_ms(ms), 1000));
    sched::Job *job = sched.pick((double)ms, busy, quiet);
    if (!worker && job && !job->overdue((double)ms) && !player.at_blink_start((double)ms)) job = nullptr;  // wait for the blink to turn on
    if (job) {
      if (!worker && player.blinking()) {
        // Show the lit frame now; the pause will hold it.
        draw_frame(ms, n);
        last_draw_ = ms;
      }
      long long st = clock->ms();
      job_err_.clear();
      bool forced = job->overdue((double)st) && (busy || quiet < sched.budget_ms);
      // A job either skips or launches a Flight; launch() reads these.
      pending_job_ = job;
      pending_start_ = st;
      pending_forced_ = forced;
      sched::Result result = job->run((double)st);
      pending_job_ = nullptr;
      if (result == sched::SKIP) job->due_at = (double)clock->ms() + job->interval_ms;
      ms = clock->ms();
    }
  }
  trial_check(ms);
  if (!flight_) maybe_install(ms, anim);
  ms = clock->ms();
  led_update();
  do_light(ms);

  // Redraw every ~33 ms while animating; otherwise only when something on
  // screen can have changed.
  n = now(ms);
  player.wall_ms = (double)now_ms(ms);
  std::optional<std::string> key = chooser.open ? chooser.frame_key((double)ms) : player.frame_key((double)ms, n);
  if (sliding(ms) || (!chooser.open && player.screen != shown_) || (chooser.open && shown_ != "chooser")) key.reset();
  if (last_draw_ < 0 || (!key ? ms - last_draw_ >= 33 : key != last_key_)) {
    if (draw_frame(ms, n)) {
      last_draw_ = ms;
      last_key_ = key;
      stats.draws++;
    }
  }
}

// ---- brightness (light.h) ----

void Board::do_light(long long ms) {
  if (light && ms - light_read_ >= light::READ_EVERY) {
    light_read_ = ms;
    double lux;
    if (light->read(lux)) sense_.reading(lux, ms);
  }
  apply_bright(ms);
}

void Board::apply_bright(long long ms) {
  // Before the first payload the panel stays at full.
  if (!player.has_p) return;
  bool sensed = ab_min_ && light && sense_.live(ms);
  double want = sensed ? sense_.target(*ab_min_, ms) : payload_bright_;
  if (!fade_.has() || want != fade_.target()) {
    // The sensor's changes fade; the phone's (fixed, off, back to auto) are immediate.
    fade_.set(want, ms, sensed && fade_.has() ? light::FADE_MS : 0);
    if (sensed) {
      char buf[64];
      snprintf(buf, sizeof buf, "[light] %.3g lx: %d%%", sense_.lux(), (int)want);
      say(buf);
    }
  }
  double v = fade_.value(ms);
  if (applied_ && std::fabs(v - *applied_) < 0.25 && v != fade_.target()) return;
  if (applied_ && v == *applied_) return;
  applied_ = v;
  double share = display->set_brightness(v / 100);
  bool was_scaled = !player.hw_bright;
  player.hw_bright = share >= 1;
  player.bright = share * 100;
  if (was_scaled || !player.hw_bright) last_key_.reset();  // the renderer's scale changed: redraw
}

// ---- OTA updates (ota.h) ----

bool Board::wants_install() const {
  if (!ota || !offer || firmware.empty() || offer->v == firmware) return false;
  if (offer->sig.empty() || !ota->can_verify()) return false;  // unsigned, or no key: never installed (health says so)
  if (!ota->trial().empty()) return false;  // one at a time: this build is still on trial
  return ota::mark(offer->v, offer->retry) != ota->bad();
}

void Board::maybe_install(long long ms, bool busy) {
  if (!wants_install()) {
    wanted_since_.reset();
    return;
  }
  if (!wanted_since_) wanted_since_ = ms;
  if (ms < install_after_ || chooser.open) return;
  // The install blocks the loop for a while: start it between animations,
  // or anyway once it has waited long enough.
  if (busy && ms - *wanted_since_ < ota::WAIT_FOR_GAP_MS) return;
  install();
}

void Board::install() {
  // Download into the unused slot, check it, restart into it. The panel
  // shows UPDATING and the percentage; on failure the board carries on and
  // tries again after ota::RETRY_MS.
  FirmwareOffer o = *offer;
  say("[ota] installing " + o.v + " (" + std::to_string(o.size) + " bytes) over " + firmware);
  if (led) led->set("fetch");
  status("updating", "0");
  std::string err;
  bool ok = ota->begin(o.size, err);
  if (ok) {
    long long got = 0;
    int shown = 0;
    ok = net->firmware(o.v, o.size, [&](const uint8_t *d, size_t n) {
      if (!ota->write(d, n)) {
        err = "Write";
        return false;
      }
      got += (long long)n;
      int pct = (int)(got * 100 / o.size);
      if (pct >= shown + 5 || got == o.size) {
        shown = pct;
        status("updating", std::to_string(pct));  // also feeds the watchdog
      } else if (watchdog) {
        watchdog->feed();
      }
      return true;
    }, err);
    if (ok) ok = ota->finish(o, err);
  }
  if (ok) {
    say("[ota] " + o.v + " installed; restarting into it");
    status("updating", "100");
    ota->restart();
    return;  // the board restarts; tests carry on
  }
  ota->abort();
  if (err.empty()) err = "Error";
  say("[ota] install of " + o.v + " failed: " + err);
  stats.fails++;
  last_error = "firmware:" + err;
  ota_err_ = err;
  install_after_ = clock->ms() + ota::RETRY_MS;
  led_base = "failing";
  last_draw_ = -1;  // redraw the screen over the status
}

void Board::trial_check(long long ms) {
  if (!ota) return;
  // Only this build's own trial; one just installed waits for its restart.
  std::string t = ota->trial();
  if (t.empty() || t != firmware) return;
  long long up = ms - run_start_;
  if (reached_server && up >= ota::KEEP_AFTER_MS) {
    say("[ota] " + t + " reached the server and ran " + std::to_string(up / 1000) + " s: keeping it");
    ota->keep();
  } else if (!reached_server && up >= ota::GIVE_UP_MS) {
    say("[ota] " + t + " hasn't reached the server in " + std::to_string(up / 1000) + " s: rolling back");
    ota->roll_back("noserver");
  }
}

std::string Board::ota_health() const {
  // `hx` (contract: /board/version): the trial, a rolled-back offer, or the
  // last failed install this run.
  if (!ota) return "";
  std::string t = ota->trial();
  if (!t.empty()) return "trial:" + t;
  if (!ota_err_.empty()) return "error:" + ota_err_;
  if (offer && offer->v != firmware && !ota->can_verify()) return "nokey:" + offer->v;
  if (offer && offer->v != firmware && offer->sig.empty()) return "unsigned:" + offer->v;
  // Still offered, but this board rolled it back: it won't install it again
  // until the control page's "Try again".
  if (offer && ota::mark(offer->v, offer->retry) == ota->bad()) return "rolledback:" + offer->v;
  return "";
}

void Board::fetching() {
  // Blue while a request is on its way; land() sets the LED back after.
  if (led) led->set("fetch");
}

void Board::led_update() {
  if (!led) return;
  if (flight_) led->set("fetch");
  else led->set(led_base == "ok" ? "off" : led_base);
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

void Board::do_knob(long long ms) {
  // Clicks are read even before the first payload so they don't pile up.
  // While a choice is being sent they wait in the encoder, as they would
  // behind a blocking request.
  if (!knob || chooser.committing) return;
  int c = knob->clicks();
  if (!c || !player.has_p) return;
  const Value &k = player.p["knob"];
  int n = (int)k["ring"].size();
  if (n < 1) return;  // a server without the knob ring
  chooser.turn(c, (int)k["at"].num(0), n, (double)ms);
}

void Board::commit_choice(long long ms) {
  // Twist and rest: the chooser has rested. Back on the starting screen it
  // just closes; otherwise the selection goes to the server, which answers
  // with the update for its screen. The amber frame holds while it's sent.
  const Value &ring = player.p["knob"]["ring"];
  if (chooser.cancelled() || chooser.selected() >= (int)ring.size()) {
    chooser.close();
    return;
  }
  chooser.committing = true;
  if (!worker) draw_frame(ms, now(ms));  // the amber frame, before the request blocks
  if (watchdog) watchdog->feed();
  job_err_.clear();
  Flight f;
  f.id = json::str(ring[chooser.selected()]);
  f.work = [this] { return net->select(flight_->id, flight_->v, flight_->err); };
  launch(std::move(f));
}

void Board::after_select(Flight &f, long long ended) {
  stats.fetches++;
  chooser.close();
  if (f.ok) {
    say("[board] knob: " + f.id);
    apply(f.v, f.started, ended);
    reached_server = true;
    fails = 0;
    led_base = "ok";
    update_job.due_at = (double)(ended + (long long)update_job.interval_ms);
    radar_job.due_at = 0;
    logo_job.due_at = 0;
  } else {
    std::string reason = f.err.empty() ? "Error" : f.err;
    say("[board] select failed: " + reason);
    stats.fails++;
    last_error = "select:" + reason;
    fails++;
    led_base = "failing";
  }
  last_draw_ = -1;  // the new screen (or the old one back) right away
}

}  // namespace app
