import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// The stats page's charts, drawn by hand: columns over time and labelled bars. One measure per chart, in one
// colour, so the title names it and no legend is needed. Every chart has its numbers in a table too.

export const fmt = (n: number) => n.toLocaleString('en-IN');
export const compact = (n: number) => (n < 10000 ? fmt(n) : n.toLocaleString('en-IN', { notation: 'compact', maximumFractionDigits: 1 }));
export const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');

export interface Datum { key: string; label: string; value: number; detail?: string }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Clean ticks: 0 up to the first 1, 2 or 5 step that covers the largest value, three or four lines in all.
function ticksFor(max: number) {
  const raw = Math.max(max, 1) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!);
  return Array.from({ length: Math.ceil(Math.max(max, 1) / step) + 1 }, (_, i) => i * step);
}

// A column with a 4px round on its data end, square on the baseline.
const column = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

export function Columns({ data, color, unit, height = 190, everyLabel }: {
  data: Datum[]; color: string; unit: string; height?: number; everyLabel?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const ticks = ticksFor(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1];
  const left = 8 + 7 * compact(top).length, bottom = 24, pad = 8;
  const plotW = Math.max(0, width - left), plotH = height - bottom - pad;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2, band * 0.72));
  const y = (v: number) => pad + plotH - (v / top) * plotH;
  const step = everyLabel ?? Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 52))));
  const hit = active === null ? null : data[active];

  return (
    <div className="columns" ref={ref} style={{ '--c': color } as CSSProperties} onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${unit} by ${data.length > 24 ? 'day' : 'hour'}; the table below has every value`}>
          {ticks.map((t) => (
            <g key={t} className="grid">
              <line x1={left} x2={width} y1={y(t)} y2={y(t)} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = left + i * band;
            const h = (d.value / top) * plotH;
            return (
              <g key={d.key} className={active === null || active === i ? '' : 'dim'}>
                {h > 0 && <path className="mark" d={column(x + (band - barW) / 2, y(d.value), barW, h)} />}
                {i % step === 0 && <text className="x" x={x + band / 2} y={height - 6} textAnchor="middle">{d.label}</text>}
                <rect className="hit" x={x} y={0} width={band} height={height - bottom} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hit && (
        <div className="tip" style={{ left: Math.min(Math.max(left + (active! + 0.5) * band, 70), width - 70), top: y(hit.value) - 8 }}>
          <b>{fmt(hit.value)}</b> {unit}
          <span>{hit.detail ?? hit.label}</span>
        </div>
      )}
    </div>
  );
}

// Horizontal bars with their value at the tip, for named things: modes, countries, tries.
export function Bars({ rows, color }: { rows: (Datum & { color?: string })[]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars" style={{ '--c': color } as CSSProperties}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar" style={{ width: `calc((100% - 4rem) * ${r.value / max})`, background: r.color } as CSSProperties} />
            <span className="bar-value">{fmt(r.value)}</span>
          </span>
          {r.detail && <span className="bar-detail">{r.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function TableView({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="table-view">
      <summary>Show as a table</summary>
      <div className="table-scroll">
        <table>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j ? <td key={j}>{c}</td> : <th key={j} scope="row">{c}</th>))}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
