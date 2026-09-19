// Tidsstemplede logger. launchd tidsstempler ikke stdout/stderr selv, så uten
// dette er out.log/err.log umulig å korrelere med kjøringer i etterkant.
// Importeres for sideeffekten (patcher console.*) øverst i index.ts.
const TZ = process.env.GANDRE_TZ?.trim() || 'Europe/Oslo';

export function timestamp(): string {
  // sv-SE gir "YYYY-MM-DD HH:MM:SS" — sorterbart og entydig
  return new Date().toLocaleString('sv-SE', { timeZone: TZ });
}

for (const level of ['log', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => original(`[${timestamp()}]`, ...args);
}
