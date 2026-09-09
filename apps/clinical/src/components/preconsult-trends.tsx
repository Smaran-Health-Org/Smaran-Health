"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreconsultTrendGroup, PreconsultTrendPoint } from "@/lib/preconsult/brief";
import styles from "@/components/clinical.module.css";

function dateLabel(point: PreconsultTrendPoint) {
  const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(`${point.effectiveDate}T00:00:00`));
  return point.datePrecision === "exact" ? date : `${date} · ${point.datePrecision} date`;
}

function FactualChart({ points }: { points: PreconsultTrendPoint[] }) {
  const chartPoints = [...points].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const values = chartPoints.map((point) => point.value);
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const coordinates = chartPoints.map((point, index) => ({ x: 24 + (index * 252) / Math.max(1, chartPoints.length - 1), y: 112 - ((point.value - min) / range) * 82 }));
  return <figure className={styles.trendChart}><svg viewBox="0 0 300 132" role="img" aria-label="Factual observation values over recorded dates"><path d="M24 112H276" className={styles.trendAxis} /><polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} className={styles.trendLine} />{coordinates.map((point, index) => <circle key={chartPoints[index].observationId} cx={point.x} cy={point.y} r="4" className={styles.trendDot}><title>{`${chartPoints[index].valueText} ${chartPoints[index].unit} · ${dateLabel(chartPoints[index])}`}</title></circle>)}</svg><figcaption>Recorded values only — no clinical interpretation.</figcaption></figure>;
}

function CorrectionForm({ point, onClose }: { point: PreconsultTrendPoint; onClose: () => void }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(point.displayName);
  const [valueText, setValueText] = useState(point.valueText);
  const [numericValue, setNumericValue] = useState(String(point.value));
  const [unit, setUnit] = useState(point.unit);
  const [date, setDate] = useState(point.effectiveDate);
  const [precision, setPrecision] = useState(point.datePrecision);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!confirmed) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/clinical-observations/${point.observationId}/correction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, normalizedValue: { valueText, numericValue: numericValue.trim() ? Number(numericValue) : null, unit: unit || null }, effectiveDate: date || null, effectiveDatePrecision: precision, reason: reason || null, idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Could not save this correction. Please check the values and try again.");
      router.refresh(); onClose();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save this correction."); setSaving(false); }
  }
  return <form className={styles.trendCorrectionForm} onSubmit={submit}><p><strong>Correct the source to update this brief</strong><br />The original extracted value remains available and this correction does not confirm clinical state.</p><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>Value text<input value={valueText} onChange={(event) => setValueText(event.target.value)} required /></label><label>Numeric value<input type="number" step="any" value={numericValue} onChange={(event) => setNumericValue(event.target.value)} /></label><label>Unit<input value={unit} onChange={(event) => setUnit(event.target.value)} /></label><label>Effective date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Date precision<select value={precision} onChange={(event) => setPrecision(event.target.value as PreconsultTrendPoint["datePrecision"])}><option value="exact">Exact</option><option value="approximate">Approximate</option><option value="unknown">Unknown</option></select></label><label>Reason (optional)<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className={styles.consentCheck}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this is the corrected structured interpretation.</label>{error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}<div className={styles.trendActions}><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={!confirmed || saving}>{saving ? "Saving…" : "Save correction"}</button></div></form>;
}

export function PreconsultTrends({ trends }: { trends: PreconsultTrendGroup[] }) {
  const [selected, setSelected] = useState<PreconsultTrendGroup | null>(null);
  const [fullHistory, setFullHistory] = useState(false);
  const [correctionPoint, setCorrectionPoint] = useState<PreconsultTrendPoint | null>(null);
  const visiblePoints = useMemo(() => selected ? (fullHistory ? selected.allPoints : selected.recentPoints) : [], [selected, fullHistory]);
  if (!trends.length) return null;
  return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Comparable observations</p><h2>Trends</h2></div><span className={styles.panelHint}>Recorded values only</span></div><div className={styles.trendAffordances}>{trends.map((trend) => <button key={trend.id} type="button" className={styles.secondaryButton} onClick={() => { setSelected(trend); setFullHistory(false); setCorrectionPoint(null); }}>View {trend.displayName} trend</button>)}</div>{selected ? <dialog open className={styles.trendDialog} aria-label={`${selected.displayName} trend`}><div className={styles.trendDialogHeader}><div><p className={styles.eyebrow}>Comparable numeric observations</p><h2>{selected.displayName} · {selected.unit}</h2></div><button type="button" className={styles.secondaryButton} onClick={() => setSelected(null)}>Close</button></div><FactualChart points={visiblePoints} /><div className={styles.trendActions}><button type="button" className={styles.secondaryButton} onClick={() => setFullHistory((value) => !value)}>{fullHistory ? "Recent observations" : "Full available history"}</button></div><div className={styles.noteReadonly}>{visiblePoints.map((point) => <div key={point.observationId}><strong>{dateLabel(point)}</strong><p>{point.valueText} {point.unit}{point.referenceRange ? ` · Reference range: ${point.referenceRange}` : ""}</p>{point.corrected ? <p className={styles.panelHint}>Corrected interpretation: {point.valueText} {point.unit}. Original extracted value: {point.originalValueText}.</p> : null}<p><a className={styles.panelLink} href={`/api/documents/${point.sourceDocumentId}/view`}>View original evidence{point.sourcePageNumber ? ` · page ${point.sourcePageNumber}` : ""}</a></p><button type="button" className={styles.secondaryButton} onClick={() => setCorrectionPoint(point)}>Correct the source</button>{correctionPoint?.observationId === point.observationId ? <CorrectionForm point={point} onClose={() => setCorrectionPoint(null)} /> : null}</div>)}</div></dialog> : null}</section>;
}
