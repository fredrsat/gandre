// Oversetter mellom den grafiske tidsvelgeren i UI-et og cron-uttrykk.
// Enkle mønstre vises grafisk; alt annet faller tilbake til «egendefinert».

export type Schedule =
  | { type: 'manual' }
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }                  // 'HH:MM'
  | { type: 'weekly'; days: number[]; time: string } // 0 = søndag … 6 = lørdag
  | { type: 'monthly'; dom: number; time: string }
  | { type: 'custom'; cron: string };

const pad = (n: number) => String(n).padStart(2, '0');
const splitTime = (time: string): [number, number] => {
  const [h, m] = time.split(':').map(Number);
  return [h || 0, m || 0];
};

export function buildCron(s: Schedule): string | null {
  switch (s.type) {
    case 'manual': return null;
    case 'hourly': return `${s.minute} * * * *`;
    case 'daily': { const [h, m] = splitTime(s.time); return `${m} ${h} * * *`; }
    case 'weekly': { const [h, m] = splitTime(s.time); return `${m} ${h} * * ${[...s.days].sort().join(',')}`; }
    case 'monthly': { const [h, m] = splitTime(s.time); return `${m} ${h} ${s.dom} * *`; }
    case 'custom': return s.cron;
  }
}

export function parseCron(cron: string | null): Schedule {
  if (!cron) return { type: 'manual' };
  let m = cron.match(/^(\d{1,2}) \* \* \* \*$/);
  if (m) return { type: 'hourly', minute: Number(m[1]) };
  m = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (m) return { type: 'daily', time: `${pad(Number(m[2]))}:${pad(Number(m[1]))}` };
  m = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* ([\d,]+)$/);
  if (m) return {
    type: 'weekly',
    days: m[3].split(',').map(Number),
    time: `${pad(Number(m[2]))}:${pad(Number(m[1]))}`,
  };
  m = cron.match(/^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/);
  if (m) return { type: 'monthly', dom: Number(m[3]), time: `${pad(Number(m[2]))}:${pad(Number(m[1]))}` };
  return { type: 'custom', cron };
}

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'man' }, { value: 2, label: 'tir' }, { value: 3, label: 'ons' },
  { value: 4, label: 'tor' }, { value: 5, label: 'fre' }, { value: 6, label: 'lør' },
  { value: 0, label: 'søn' },
];

// Menneskelig beskrivelse til agentlisten
export function describeCron(cron: string | null): string {
  const s = parseCron(cron);
  switch (s.type) {
    case 'manual': return 'manuell';
    case 'hourly': return `hver time (:${pad(s.minute)})`;
    case 'daily': return `daglig kl. ${s.time}`;
    case 'weekly': {
      const names = s.days.map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? d).join(', ');
      return `${names} kl. ${s.time}`;
    }
    case 'monthly': return `den ${s.dom}. kl. ${s.time}`;
    case 'custom': return s.cron;
  }
}
