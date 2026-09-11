import { Cron } from 'croner';
import { config } from './config.js';
import { listAgents, markInterruptedRuns, pruneOldRuns } from './db.js';
import { executeScheduledRun } from './runner.js';

const jobs = new Map<string, Cron>();

export function startScheduler(): void {
  markInterruptedRuns();
  pruneOldRuns();
  reloadScheduler();
}

export function reloadScheduler(): void {
  for (const job of jobs.values()) job.stop();
  jobs.clear();
  for (const agent of listAgents()) {
    if (!agent.enabled || !agent.schedule_cron) continue;
    try {
      const job = new Cron(
        agent.schedule_cron,
        { timezone: config.timezone, protect: true, catch: true },
        async () => { await executeScheduledRun(agent.id); }
      );
      jobs.set(agent.id, job);
    } catch (err) {
      console.error(`[scheduler] Ugyldig cron for ${agent.name}: ${agent.schedule_cron}`, err);
    }
  }
  console.log(`[scheduler] ${jobs.size} agent(er) planlagt`);
}

export function nextRun(agentId: string): Date | null {
  return jobs.get(agentId)?.nextRun() ?? null;
}

export function validateCron(expr: string): boolean {
  try {
    new Cron(expr, { paused: true }).stop();
    return true;
  } catch {
    return false;
  }
}
