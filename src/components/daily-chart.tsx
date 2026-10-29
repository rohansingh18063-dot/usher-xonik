"use client";

import { useId, useState, type KeyboardEvent } from "react";

export type DailyPoint = { day: string; value: number };

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const format = (day: string, long = false) => (long ? longDayLabel : dayLabel).format(new Date(`${day}T00:00:00Z`));

/** The smallest round number (1, 2 or 5 times a power of ten) at or above a value. */
function niceMax(value: number) {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((step) => step * power).find((candidate) => candidate >= value)!;
}

/**
 * One series per day as columns. Hover or tap a day, or focus the chart and
 * use the arrow keys, to read its value; the same numbers are in the table.
 */
export function DailyChart({
  title,
  unit,
  points,
  testId,
}: {
  title: string;
  /** Plural noun for the values, for example "conversations". */
  unit: string;
  points: DailyPoint[];
  testId: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const max = niceMax(Math.max(0, ...points.map((point) => point.value)));
  const ticks = max >= 2 && max % 2 === 0 ? [max, max / 2, 0] : [max, 0];
  const describe = (point: DailyPoint) => `${format(point.day, true)}: ${point.value} ${point.value === 1 ? unit.replace(/s$/, "") : unit}`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = points.length - 1;
    const keys: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? last + 1) - 1),
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      Home: 0,
      End: last,
    };
    if (event.key in keys) {
      event.preventDefault();
      setActive(keys[event.key]);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  return (
    <div data-testid={testId} data-total={total}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{total}</span> in the last 30 days
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="relative w-6 shrink-0 text-right text-[11px] text-slate-400" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - tick / max) * 100}%` }}>
              {tick}
            </span>
          ))}
        </div>

        <div
          role="group"
          aria-label={`${title}, last 30 days. Use the left and right arrow keys to read each day.`}
          aria-describedby={`${id}-readout`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          className="relative h-40 flex-1 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
        >
          {ticks.map((tick) => (
            <div
              key={tick}
              className={`absolute inset-x-0 h-px ${tick === 0 ? "bg-slate-300" : "bg-slate-100"}`}
              style={{ top: `${(1 - tick / max) * 100}%` }}
              aria-hidden="true"
            />
          ))}

          <div className="absolute inset-0 flex items-end gap-[2px]">
            {points.map((point, index) => (
              <div
                key={point.day}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                onClick={() => setActive(index)}
                data-day={point.day}
                data-value={point.value}
                data-testid={`${testId}-bar`}
              >
                {point.value > 0 && (
                  <div
                    className={`w-full max-w-6 rounded-t ${active === index ? "bg-brand-700" : "bg-brand-600"}`}
                    style={{ height: `${(point.value / max) * 100}%` }}
                  />
                )}
                {active === index && (
                  <div
                    className={`pointer-events-none absolute z-10 mb-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg ${
                      index < points.length / 3 ? "left-0" : index > (points.length * 2) / 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                    style={{ bottom: `${Math.min(100, (point.value / max) * 100)}%` }}
                    aria-hidden="true"
                  >
                    <span className="font-semibold">{point.value}</span> <span className="text-slate-300">{format(point.day, true)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 ml-8 flex justify-between text-[11px] text-slate-400" aria-hidden="true">
        <span>{points[0] && format(points[0].day)}</span>
        <span>{points.at(-1) && format(points.at(-1)!.day)}</span>
      </div>
      <p id={`${id}-readout`} className="sr-only" aria-live="polite">
        {active !== null && points[active] ? describe(points[active]) : ""}
      </p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">{unit[0].toUpperCase() + unit.slice(1)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...points].reverse().map((point) => (
                <tr key={point.day}>
                  <td className="px-3 py-1.5 text-slate-600">{format(point.day, true)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-900 tabular-nums">{point.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
