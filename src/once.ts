// Kjør én agent én gang fra kommandolinjen: npm run once -- <agent-id | agent-navn>
import { listAgents, getRun } from './db.js';
import { executeRun } from './runner.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Bruk: npm run once -- <agent-id | agent-navn>');
  console.error('Tilgjengelige agenter:');
  for (const a of listAgents()) console.error(`  ${a.id}  ${a.name}`);
  process.exit(1);
}

const agent = listAgents().find((a) => a.id === arg || a.name === arg);
if (!agent) {
  console.error(`Fant ingen agent med id eller navn «${arg}»`);
  process.exit(1);
}

const result = await executeRun(agent.id, 'manual');
if ('skipped' in result) {
  console.error(`Kjøring hoppet over: ${result.skipped}`);
  process.exit(1);
}
const run = getRun(result.runId)!;
console.log(`\n--- Kjøring #${run.id}: ${run.status} ---`);
if (run.final_text) console.log(run.final_text);
if (run.error) console.error(run.error);
process.exit(run.status === 'success' ? 0 : 1);
