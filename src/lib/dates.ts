// Datas do app são sempre "dia local" no fuso de São Paulo, como texto AAAA-MM-DD.
export const TZ = "America/Sao_Paulo";

export function todaySP(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function isDay(v: string | undefined | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isMonth(v: string | undefined | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function isTime(v: string | undefined | null): v is string {
  return !!v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addDays(day: string, delta: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana que contém o dia (a visão da semana vai de segunda a domingo). */
export function weekStart(day: string): string {
  const dow = new Date(day + "T00:00:00Z").getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}

/** Os sete dias da semana que começa em `start` (uma segunda-feira). */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Ex.: "16 a 22 de novembro de 2026", "30 de novembro a 6 de dezembro de 2026". */
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const parts = (d: string) => {
    const x = new Date(d + "T00:00:00Z");
    const month = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(x);
    return { n: x.getUTCDate(), month, year: x.getUTCFullYear() };
  };
  const a = parts(start);
  const b = parts(end);
  if (a.year !== b.year) return `${a.n} de ${a.month} de ${a.year} a ${b.n} de ${b.month} de ${b.year}`;
  if (a.month !== b.month) return `${a.n} de ${a.month} a ${b.n} de ${b.month} de ${b.year}`;
  return `${a.n} a ${b.n} de ${b.month} de ${b.year}`;
}

/** Nome curto do dia da semana: "Seg", "Ter"... */
export function weekdayShort(day: string): string {
  const s = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(new Date(day + "T00:00:00Z"));
  const out = s.replace(".", "");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function monthLabel(ym: string): string {
  const d = new Date(ym + "-01T00:00:00Z");
  const s = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dayLabel(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const s = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  const out = s.replace("-feira", "");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function shortDayLabel(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const s = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(d)
    .replace("-feira", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Cell = { day: string; n: number; inMonth: boolean };

/** Grade do mês, semanas começando no domingo. */
export function monthGrid(ym: string): Cell[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((first.getUTCDay() + daysInMonth) / 7);
  const cells: Cell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({
      day: d.toISOString().slice(0, 10),
      n: d.getUTCDate(),
      inMonth: d.getUTCMonth() === m - 1,
    });
  }
  return cells;
}

const MONTH_FOLDER_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Pastas do Drive esperadas para um dia, a partir da pasta do cliente: "AAAA", "MM - Mês", "DD". Ex.: 2026 / 11 - Novembro / 21 */
export function dayFolders(day: string): [string, string, string] {
  const [y, m, d] = day.split("-");
  return [y, `${m} - ${MONTH_FOLDER_NAMES[Number(m) - 1]}`, d];
}
