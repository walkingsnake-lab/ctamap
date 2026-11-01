// Network jobs (design spec §2, "Scheduler").
//
// Requests run on the network worker (app.h Worker), off the draw loop, so
// they never pause an animation; jobs simply run when due, one at a time.
// A job past its deadline goes first, then the one due longest. While the
// knob's chooser is open only overdue jobs run, so the commit goes out the
// moment the knob rests.
//
// (The M4's CircuitPython firmware, firmware/boardlib/sched.py, blocks the
// loop on every request and fits them into animation gaps instead.)
#pragma once

#include <algorithm>
#include <functional>
#include <string>
#include <vector>

namespace sched {

enum Result { OK, SKIP, MORE, FAIL, STARTED };  // STARTED: the job launched a request (app.h Flight)

struct Job {
  std::string name;
  double interval_ms;  // time between runs
  double deadline_ms;  // past due this long, it runs even while the chooser is open
  std::function<Result(double ms)> run;
  double due_at = 0;

  Job(const std::string &n, double interval, double deadline, std::function<Result(double)> fn, double due = 0)
      : name(n), interval_ms(interval), deadline_ms(deadline), run(std::move(fn)), due_at(due) {}
  bool overdue(double ms) const { return ms >= due_at + deadline_ms; }
};

class Scheduler {
 public:
  std::vector<Job *> jobs;
  double fetch_ms = 0;  // average request time (health `hb`), 0 before the first

  Job *add(Job *job) {
    jobs.push_back(job);
    return job;
  }

  void due_now(Job *job, double ms) { job->due_at = std::min(job->due_at, ms); }

  // The job to run now, or null: the earliest-due overdue job, else
  // (unless only_overdue) the earliest-due due job.
  Job *pick(double ms, bool only_overdue) const {
    Job *over = nullptr, *due = nullptr;
    for (Job *j : jobs) {
      if (ms < j->due_at) continue;
      if (j->overdue(ms) && (!over || j->due_at < over->due_at)) over = j;
      if (!due || j->due_at < due->due_at) due = j;
    }
    if (over || only_overdue) return over;
    return due;
  }

  // Record a run: reschedule, and track the request time.
  void ran(Job *job, double started_ms, double ended_ms, bool ok) {
    double took = ended_ms - started_ms;
    fetch_ms = fetch_ms == 0 ? took : (double)(long long)(fetch_ms * 0.7 + took * 0.3);
    job->due_at = ended_ms + (ok ? job->interval_ms : std::min(job->interval_ms, 5000.0));
  }
};

}  // namespace sched
