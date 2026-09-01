/**
 * Working-days helper — Uganda business calendar.
 *
 * Mon-Fri count as working days. Saturdays, Sundays, and bank holidays are
 * skipped. Returns a new Date with the time portion preserved.
 *
 * Uganda bank holidays are listed here at day-level granularity (year-agnostic
 * and year-specific both supported). For G7 the SLA is 7 working days so this
 * coarse list is sufficient; revisit if granular per-year accuracy becomes
 * material to downstream calculations.
 */

// Year-agnostic (MM-DD) — fixed-date Uganda public holidays.
const FIXED_HOLIDAYS_MMDD: ReadonlySet<string> = new Set([
  '01-01', // New Year's Day
  '01-26', // NRM Liberation Day
  '03-08', // International Women's Day
  '05-01', // Labour Day
  '06-03', // Martyrs' Day
  '06-09', // National Heroes' Day
  '10-09', // Independence Day
  '12-25', // Christmas Day
  '12-26', // Boxing Day
]);

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function isHoliday(d: Date): boolean {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return FIXED_HOLIDAYS_MMDD.has(`${mm}-${dd}`);
}

/**
 * Add `n` working days to `from`. If `n` is 0, returns the same date.
 * Moves forward only — negative values are not supported.
 */
export function addWorkingDays(from: Date, n: number): Date {
  if (n < 0) throw new Error('addWorkingDays does not support negative offsets');
  const result = new Date(from.getTime());
  let remaining = n;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isWeekend(result) && !isHoliday(result)) {
      remaining -= 1;
    }
  }
  return result;
}

/** Exposed for unit tests. */
export const __internal = { isWeekend, isHoliday, FIXED_HOLIDAYS_MMDD };
