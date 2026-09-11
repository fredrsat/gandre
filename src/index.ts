import { startScheduler } from './scheduler.js';
import { startWebServer } from './web/server.js';

startScheduler();
startWebServer();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
