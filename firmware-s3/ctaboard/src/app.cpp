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

Board::~Board() {
  draw::big_free(last_px_);
  draw::big_free(slide_px_);
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
    draw::render_status(f, kind, detail, display->cols());
    shown(SHOWN_STATUS, ms);
    memcpy(last_px_, f.px, f.bytes());
    last_w_ = f.w;
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

void Board::apply(Value &in, long long st, long long ms) {
  // The payload moves into the player (it's consumed): one tree in memory,
  // not two.
  sync(in["now"].num(), st, ms);
  player.set_payload(std::move(in), (double)ms);
  const Value &p = player.p;
  if (peek.open) peek.resync(knob_counts(), (double)ms);
  double b = p["bright"].is_null() ? 100 : p["bright"].num();
  payload_bright_ = std::max(0.0, std::min(100.0, b));
  const Value &ab = p["ab"];
  ab_min_.reset();
  if (ab.is_obj() && ab["min"].is_num()) ab_min_ = std::max(0.0, std::min(100.0, ab["min"].num()));
  apply_bright(ms);
  player.set_screen(override_.resolve(player.auto_screen(now(ms)), p["v"].num()), (double)ms);
  update_job.interval_ms = (double)(player.live_game() ? LIVE_EVERY : UPDATE_EVERY);
  if (player.missing_cloud()) sky_job.due_at = 0;  // a new sky: fetch its clouds next
}

void Board::shown(int what, long long ms) {
  // A different screen than the last frame's (spec §2, "Screen change"). The
  // first frame ever, status screens, and the knob's chooser (a turn should
  // answer at once) just appear, cutting any transition short. A change the
  // knob or a button made slides in over the old frame, the way it was
  // turned or pressed (UP from the left, DOWN from the right); any other
  // (the phone, the auto rotation, leaving a status screen) fades through
  // black. A change during a transition starts from what's on the panel
  // (last_px_ is the shown frame, mid-transition included), so it never
  // snaps; a slide that interrupts one runs quicker (SCREEN_SLIDE_QUICK_MS),
  // so presses in a row read as one fast run.
  if (what != shown_ && shown_ != SHOWN_NONE) {
    // The peek chooser shows the views themselves: no transition into it,
    // and none out of it (the chosen view is already on the panel).
    if (what == SHOWN_STATUS || what == SHOWN_CHOOSER || what == SHOWN_PEEK || shown_ == SHOWN_PEEK) {
      trans_ = NO_TRANS;
    } else {
      bool chained = transitioning(ms);
      memcpy(slide_px_, last_px_, (size_t)last_w_ * draw::Frame::H * 3);
      slide_w_ = last_w_;
      trans_start_ = ms;
      if (shown_ == SHOWN_CHOOSER || button_dir_) {
        trans_ = SLIDE;
        slide_dir_ = shown_ == SHOWN_CHOOSER ? (chooser_travel_ < 0 ? -1 : 1) : button_dir_;
        slide_ms_ = chained ? SCREEN_SLIDE_QUICK_MS : draw::SCREEN_SLIDE_MS;
      } else {
        trans_ = FADE;
      }
    }
  }
  button_dir_ = 0;  // a press is for the frame right after it
  shown_ = what;
}

bool Board::draw_frame(long long ms, long long n) {
  int what = chooser.open ? SHOWN_CHOOSER : peek.open ? SHOWN_PEEK : (int)player.screen;
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
    } else if (peek.open) {
      draw_peek(f, ms, n);
    } else {
      player.draw(f, (double)ms, n);
    }
    // shown() starts a slide or fade on a change (from the last shown frame:
    // t = 0); then that; then this frame, as shown, is kept for the next.
    shown(what, ms);
    if (sliding(ms)) {
      // A quick slide runs the same curve faster.
      double t = (double)(ms - trans_start_) * draw::SCREEN_SLIDE_MS / slide_ms_;
      draw::slide_frames(slide_px_, f, draw::slide_offset(t, f.w), slide_dir_, slide_w_);
    } else if (fading(ms)) {
      draw::fade_frames(slide_px_, f, (double)(ms - trans_start_), slide_w_);
    }
    memcpy(last_px_, f.px, f.bytes());
    last_w_ = f.w;
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
             (long long)sched.fetch_ms, stats.fails, stats.reconnects);
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
    if (setup && setup->wiped() > 0) q += "&hz=" + std::to_string(setup->wiped());
    health_q_ = q;
  }
  // A rain visit the knob ended (`hq`: no visit before then, epoch s) rides
  // on every check while it lasts, so the server and the phone know.
  std::string out = health_q_;
  if (player.visit_skip_until > now(ms)) out += "&hq=" + std::to_string(player.visit_skip_until);
  // The light sensor's reading rides on every check (every ~10 s), fresh,
  // so the phone can be used to tune it.
  if (light && sense_.live(ms)) {
    char lx[24];
    snprintf(lx, sizeof lx, "&ha=%.3g", sense_.lux());
    out += lx;
  }
  return out;
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
    // A new owner: forget the saved WiFi, once per stamp (contract "Board keys").
    long long wipe = (long long)r["wipe"].num(0);
    if (setup && wipe > setup->wiped()) {
      say("[setup] the board has a new owner; forgetting saved WiFi");
      setup->forget(wipe);
    } else if (setup) {
      setup->checked_in();
    }
    return sched::OK;
  };
  launch(std::move(f));
  return sched::STARTED;
}

sched::Result Board::do_update(double) {
  // The server sends only the shown screen's sections; while a button press
  // overrides the screen, ask for that one.
  Flight f;
  std::string scr = override_.screen ? screen::name(*override_.screen) : "";
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
  flight_ = std::move(f);
  fetching();
  if (worker) {
    worker->start([this] { flight_->ok = flight_->work(); });
    return;
  }
  // No worker (its task couldn't start): the request blocks the loop here,
  // and animations pause until it's back.
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
  stats.fetches++;
  sched.ran(job, (double)st, (double)ended, result != sched::FAIL);
  if (result == sched::MORE) {
    // More of a set to fetch (radar frames, logos). While that screen is
    // showing, go again ahead of other due jobs; while prefetching, take
    // its turn with them.
    bool showing = player.screen == (job == &radar_job ? Screen::Weather : Screen::Baseball);
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
  // The peek chooser at rest: the bar drops away, and unless the knob came
  // back to where it started, the choice goes out as soon as nothing else
  // is in flight. It closes once the bar is gone and the answer is in.
  if (peek.rested((double)ms)) {
    bool commit = !peek.cancelled();
    if (commit) {
      const Value &k = player.p["knob"];
      const Value &vv = k["vars"][peek.k][peek.vi()];
      peek_cat_ = json::str(k["ring"][peek.k]);
      peek_var_ = vv.is_str() ? vv.s : "";
    }
    peek.close((double)ms, commit);
  }
  if (peek.open && peek.committing && !peek.sent && !flight_) {
    send_peek();
    ms = clock->ms();
  }
  if (peek.open && peek.closing && !peek.committing && (double)ms - peek.closed_at >= draw::PEEK_DOWN_MS) peek.open = false;

  long long n = now(ms);
  if (player.has_p) {
    // Timed radar visits: follow the server's schedule unless a button
    // press is overriding it.
    player.set_screen(override_.resolve(player.auto_screen(n), player.p["v"].num()), (double)ms);
  }
  if (fails == 0 && player.awaiting_drop(n)) {
    // A train is due to drop but the payload is older than that moment:
    // fetch now rather than drop it on stale data.
    sched.due_now(&update_job, (double)ms);
  }
  bool anim = player.busy((double)ms) || transitioning(ms);
  if (!flight_ && !(peek.committing && !peek.sent)) {
    // While the chooser is open only overdue requests run, so the commit
    // goes out the moment the knob rests. (The peek chooser lets them run:
    // the radar frames it shows may still be on their way.)
    sched::Job *job = sched.pick((double)ms, chooser.open);
    if (job) {
      long long st = clock->ms();
      job_err_.clear();
      // A job either skips or launches a Flight; launch() reads these.
      pending_job_ = job;
      pending_start_ = st;
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
  std::optional<screen::FrameKey> key = chooser.open ? chooser.frame_key((double)ms)
                                       : peek.open   ? std::nullopt  // live views: every frame
                                                     : player.frame_key((double)ms, n);
  if (transitioning(ms) || (chooser.open ? SHOWN_CHOOSER : peek.open ? SHOWN_PEEK : (int)player.screen) != shown_) key.reset();
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
  if (ms < install_after_ || chooser.open || peek.open) return;
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
    button_dir_ = stp;  // the new screen slides in from the way pressed
    player.set_screen(override_.press(stp, player.screen, player.p["v"].num()), (double)ms);
    radar_job.due_at = 0;
    // The payload only has the old screen's data: fetch the new one now.
    update_job.due_at = (double)ms - update_job.deadline_ms;
  }
}

void Board::do_knob(long long ms) {
  // Clicks are read even before the first payload so they don't pile up.
  // While a choice is being sent they wait in the encoder, as they would
  // behind a blocking request. The push button: a debounced press, and its
  // release.
  if (!knob) return;
  bool raw = knob->pressed();
  bool down = knob_press_.update(raw, (double)ms), up = false;
  if (down) knob_held_ = true;
  else if (knob_held_ && !raw) {
    knob_held_ = false;
    up = true;
  }
  if (chooser.committing || (peek.open && peek.committing)) return;
  int c = knob->clicks();
  if (!player.has_p) return;
  const Value &k = player.p["knob"];
  int n = (int)k["ring"].size();
  if (n < 1) return;  // a server without the knob ring
  bool idle = !chooser.open && !peek.open;
  // A board that's off: the first turn or press turns it back on (the
  // server sets Auto brightness on any select), on the screen it was on.
  if (idle && (c || down) && player.p["bright"].is_num() && player.p["bright"].num() == 0 && !player.p["ab"].truthy()) {
    if (flight_) return;
    say("[board] knob: turning the panel back on");
    if (watchdog) watchdog->feed();
    job_err_.clear();
    Flight f;
    f.id = json::str(k["ring"][(size_t)((((int)k["at"].num(0)) % n + n) % n)]);
    f.work = [this] { return net->select(flight_->id, "", flight_->v, flight_->err); };
    launch(std::move(f));
    return;
  }
  // A Rain nearby visit (spec §10, "Interruptions"): the first turn or
  // press only ends it; the next one opens the chooser.
  long long nw = now(ms);
  if (idle && (c || down) && !override_.screen && player.visiting(nw)) {
    long long every = (long long)player.p["radar"]["visit"]["every"].num(60);
    player.visit_skip_until = (draw::fdiv(nw, every) + 1) * every;
    say("[board] knob: ended the rain visit");
    player.set_screen(player.auto_screen(nw), (double)ms);
    sched.due_now(&version_job, (double)ms);  // tell the server (hq) now
    return;
  }
  if (!peek_mode()) {
    if (c) chooser.turn(c, (int)k["at"].num(0), n, (double)ms);
    return;
  }
  // Peek: a turn or a press opens it on the screen the board is on (a
  // press there then steps to the next variant on release).
  if ((c || down) && (!peek.open || peek.closing)) open_peek(ms);
  if (!peek.open) return;
  if (down) peek.press((double)ms);
  if (c) peek.turn(c, (double)ms);
  if (up) peek.release((double)ms);
}

// knob.vars sizes, one per ring entry.
std::vector<int> Board::knob_counts() const {
  const Value &k = player.p["knob"];
  std::vector<int> counts;
  for (size_t i = 0; i < k["ring"].size(); i++) counts.push_back((int)k["vars"][i].size());
  return counts;
}

void Board::open_peek(long long ms) {
  const Value &k = player.p["knob"];
  std::vector<int> sels;
  for (size_t i = 0; i < k["ring"].size(); i++) sels.push_back((int)k["sel"][i].num(0));
  peek.start(knob_counts(), sels, (int)k["at"].num(0), (double)ms);
}

void Board::send_peek() {
  // The choice, with its variant: the server answers with the update for
  // the new screen.
  // The choice as the chooser closed on it (peek_cat_, peek_var_).
  Flight f;
  f.id = peek_cat_;
  f.variant = peek_var_;
  peek.sent = true;
  if (watchdog) watchdog->feed();
  job_err_.clear();
  f.work = [this] { return net->select(flight_->id, flight_->variant, flight_->v, flight_->err); };
  launch(std::move(f));
}

const Value &Board::peek_payload(int k, int vi) {
  // Built once per payload; only the views on screen are kept (a weather
  // or clock view is a copy of the payload).
  if (peek_gen_ != player.gen) {
    peek_views_.clear();
    peek_gen_ = player.gen;
  }
  int key = k * 32 + vi;
  auto it = peek_views_.find(key);
  if (it == peek_views_.end()) {
    int keep[2] = {peek.k * 32 + peek.vi(), peek.slide_k * 32 + peek.slide_vi};
    for (auto e = peek_views_.begin(); e != peek_views_.end();) {
      if (e->first != keep[0] && e->first != keep[1]) e = peek_views_.erase(e);
      else ++e;
    }
    it = peek_views_.emplace(key, draw::peek_view(player.p, k, vi)).first;
  }
  return it->second.payload(player.p);
}

void Board::draw_peek(draw::Frame &f, long long ms, long long n) {
  draw::RenderOpts o;
  o.screen = "peek";
  o.apply_bright = !player.hw_bright;
  o.bright = player.bright;
  o.now = (double)n;
  o.ms = player.wall_ms;  // the skyline's animation clock
  o.frames = &player.radar_frames;
  o.clouds = &player.clouds;
  draw::RenderOpts::Peek pk;
  pk.k = peek.k;
  pk.vi = peek.vi();
  double t = (double)ms;
  pk.drop = peek.closing ? draw::peek_drop(false, t - peek.closed_at) : draw::peek_drop(true, t - peek.opened);
  if (peek.slide && t - peek.slide_t0 < (peek.slide_y ? draw::PEEK_Y_MS : draw::PEEK_X_MS)) {
    pk.slide = true;
    pk.slide_k = peek.slide_k;
    pk.slide_vi = peek.slide_vi;
    pk.slide_t = t - peek.slide_t0;
    pk.slide_y = peek.slide_y;
    pk.slide_dir = peek.slide_dir;
    pk.slide_view = &peek_payload(peek.slide_k, peek.slide_vi);
  } else {
    peek.slide = false;
  }
  pk.view = &peek_payload(pk.k, pk.vi);
  o.peek = pk;
  draw::render(player.p, f, o);
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
  f.work = [this] { return net->select(flight_->id, "", flight_->v, flight_->err); };
  launch(std::move(f));
}

void Board::after_select(Flight &f, long long ended) {
  stats.fetches++;
  chooser.close();
  peek.committing = false;  // the peek closes once its bar is gone
  if (f.ok) {
    say("[board] knob: " + f.id + (f.variant.empty() ? "" : " " + f.variant));
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
