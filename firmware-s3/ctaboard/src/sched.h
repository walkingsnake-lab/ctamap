// Network scheduler (design spec §2, "Scheduler"). A port of
// firmware/boardlib/sched.py.
//
// Each HTTPS request blocks the main loop for a second or so (the panel
// stays lit: the DMA keeps refreshing it, but animations pause), so
// requests run in animation gaps:
//   - a job runs when it's due and the next animation is at least the fetch
//     budget away (and nothing is animating);
//   - past its deadline it runs anyway (a brief pause beats stale times).
// The fetch budget starts at 2 s and follows the measured request time.
#pragma once

#include <algorithm>
#include <functional>
#include <string>
#include <vector>

namespace sched {

enum Result { OK, SKIP, MORE, FAIL };

struct Job {
  std::string name;
  double interval_ms;  // time between runs
  double deadline_ms;  // max wait past due before forcing
  std::function<Result(double ms)> run;
  double due_at = 0;

  Job(const std::string &n, double interval, double deadline, std::function<Result(double)> fn, double due = 0)
      : name(n), interval_ms(interval), deadline_ms(deadline), run(std::move(fn)), due_at(due) {}
  bool overdue(double ms) const { return ms >= due_at + deadline_ms; }
};

class Scheduler {
 public:
  explicit Scheduler(double budget = 2000) : budget_ms(budget) {}
  double budget_ms;
  std::vector<Job *> jobs;

  Job *add(Job *job) {
    jobs.push_back(job);
    return job;
  }

  void due_now(Job *job, double ms) { job->due_at = std::min(job->due_at, ms); }

  // The job to run now, or null. Overdue jobs first, then the most overdue
  // due job if there's a long enough gap.
  Job *pick(double ms, bool busy, double quiet_ms) const {
    std::vector<Job *> due;
    for (Job *j : jobs)
      if (ms >= j->due_at) due.push_back(j);
    if (due.empty()) return nullptr;
    std::stable_sort(due.begin(), due.end(), [](const Job *a, const Job *b) { return a->due_at < b->due_at; });
    for (Job *j : due)
      if (j->overdue(ms)) return j;
    if (!busy && quiet_ms >= budget_ms) return due[0];
    return nullptr;
  }

  // Record a run: reschedule, and learn the fetch budget.
  void ran(Job *job, double started_ms, double ended_ms, bool ok) {
    double took = ended_ms - started_ms;
    // Slow-ish moving average, never below 1 s.
    budget_ms = std::max(1000.0, (double)(long long)(budget_ms * 0.7 + took * 1.2 * 0.3));
    job->due_at = ended_ms + (ok ? job->interval_ms : std::min(job->interval_ms, 5000.0));
  }
};

}  // namespace sched
