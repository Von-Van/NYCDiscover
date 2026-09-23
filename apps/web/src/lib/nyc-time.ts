export const NYC_TIMEZONE = "America/New_York";

export function nycDate(value: Date | string = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: NYC_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function nycTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: NYC_TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function nycLongDate(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: NYC_TIMEZONE, dateStyle: "full" }).format(new Date(value));
}

export function laterTodayInNYC(clock: string, now = new Date()): Date {
  if (!/^\d{2}:\d{2}$/.test(clock)) throw new Error("Choose a valid New York start time.");
  const day = nycDate(now);
  const matches = ["-04:00", "-05:00"].map((offset) => new Date(`${day}T${clock}:00${offset}`)).filter((date) => {
    if (Number.isNaN(date.getTime()) || nycDate(date) !== day) return false;
    return new Intl.DateTimeFormat("en-GB", { timeZone: NYC_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) === clock;
  }).sort((a, b) => a.getTime() - b.getTime());
  const result = matches.find((date) => date >= now) ?? matches[0];
  if (!result) throw new Error("That time does not exist today in New York. Choose another time.");
  return result;
}
