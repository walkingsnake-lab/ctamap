# Network scheduler (design spec §2, "Scheduler").
#
# CircuitPython is single-threaded and each HTTPS request through the M4's
# WiFi co-processor blocks the display for a second or more, so requests run
# in animation gaps:
#   - a job runs when it's due and the next animation is at least the fetch
#     budget away (and nothing is animating);
#   - past its deadline it runs anyway (a brief freeze beats stale times).
# The fetch budget starts at 2 s and follows the measured request time.

class Job:
    def __init__(self, name, interval_ms, deadline_ms, run, due_at=0):
        self.name = name
        self.interval_ms = interval_ms   # time between runs
        self.deadline_ms = deadline_ms   # max wait past due before forcing
        self.run = run                   # callable(ms) -> True on success
        self.due_at = due_at

    def overdue(self, ms):
        return ms >= self.due_at + self.deadline_ms


class Scheduler:
    def __init__(self, budget_ms=2000):
        self.jobs = []
        self.budget_ms = budget_ms

    def add(self, job):
        self.jobs.append(job)
        return job

    def due_now(self, job, ms):
        job.due_at = min(job.due_at, ms)

    def pick(self, ms, busy, quiet_ms):
        """The job to run now, or None. Overdue jobs first, then the most
        overdue due job if there's a long enough gap."""
        due = [j for j in self.jobs if ms >= j.due_at]
        if not due:
            return None
        due.sort(key=lambda j: j.due_at)
        for j in due:
            if j.overdue(ms):
                return j
        if not busy and quiet_ms >= self.budget_ms:
            return due[0]
        return None

    def ran(self, job, started_ms, ended_ms, ok):
        """Record a run: reschedule, and learn the fetch budget."""
        took = ended_ms - started_ms
        # Slow-ish moving average, never below 1 s.
        self.budget_ms = max(1000, int(self.budget_ms * 0.7 + took * 1.2 * 0.3))
        job.due_at = ended_ms + (job.interval_ms if ok else min(job.interval_ms, 5000))
