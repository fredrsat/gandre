import './log.js';
import { startScheduler } from './scheduler.js';
import { startWebServer } from './web/server.js';

// Uten disse dreper én løs promise-avvisning (f.eks. fra en MCP-barneprosess
// som dør stygt) hele prosessen — og dermed alle agentene på én gang.
process.on('unhandledRejection', (reason) => {
  console.error('[gandre] Ubehandlet promise-avvisning (fortsetter):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[gandre] Uventet fatal feil — avslutter, launchd starter på nytt:', err);
  process.exit(1);
});

startScheduler();
startWebServer();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
