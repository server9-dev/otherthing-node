/**
 * Scheduler Service — thin setInterval wrapper with named jobs
 */

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  callback: () => Promise<void> | void;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
  timer: NodeJS.Timeout | null;
}

class SchedulerService {
  private jobs: Map<string, ScheduledJob> = new Map();

  register(name: string, intervalMs: number, callback: () => Promise<void> | void): void {
    if (this.jobs.has(name)) {
      this.unregister(name);
    }

    const job: ScheduledJob = {
      name,
      intervalMs,
      callback,
      lastRun: null,
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
      running: false,
      timer: null,
    };

    job.timer = setInterval(async () => {
      if (job.running) return;
      job.running = true;
      try {
        await job.callback();
        job.lastRun = new Date().toISOString();
      } catch (err) {
        console.error(`[Scheduler] Job "${name}" failed:`, err);
      } finally {
        job.running = false;
        job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
      }
    }, intervalMs);

    this.jobs.set(name, job);
    console.log(`[Scheduler] Registered job "${name}" (every ${intervalMs / 1000}s)`);
  }

  unregister(name: string): void {
    const job = this.jobs.get(name);
    if (job?.timer) {
      clearInterval(job.timer);
    }
    this.jobs.delete(name);
  }

  async trigger(name: string): Promise<boolean> {
    const job = this.jobs.get(name);
    if (!job) return false;
    if (job.running) return false;

    job.running = true;
    try {
      await job.callback();
      job.lastRun = new Date().toISOString();
      return true;
    } catch (err) {
      console.error(`[Scheduler] Manual trigger of "${name}" failed:`, err);
      return false;
    } finally {
      job.running = false;
      job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
    }
  }

  getJobs(): Array<Omit<ScheduledJob, 'callback' | 'timer'>> {
    return Array.from(this.jobs.values()).map(({ name, intervalMs, lastRun, nextRun, running }) => ({
      name, intervalMs, lastRun, nextRun, running,
    }));
  }

  getJob(name: string): ScheduledJob | undefined {
    return this.jobs.get(name);
  }

  shutdown(): void {
    for (const [name, job] of this.jobs) {
      if (job.timer) clearInterval(job.timer);
      console.log(`[Scheduler] Stopped job "${name}"`);
    }
    this.jobs.clear();
  }
}

export const schedulerService = new SchedulerService();
