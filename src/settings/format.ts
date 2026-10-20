import type { Formatters } from "../../shared/i18n/locale";

const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/**
 * A disk size in the UI language, such as "12.3 MB", from 1024-based
 * units; anything under 1 kB still reads in kB, as the server words sizes.
 */
export function formatSize(bytes: number, format: Pick<Formatters, "number">): string {
  let value = Math.max(0, bytes) / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return format.number(value, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  });
}
