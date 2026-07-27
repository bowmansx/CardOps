"use client";

import { useEffect, useState } from "react";
import { Camera, Loader2, Check, AlertTriangle, Bookmark, Plus, Trash2 } from "lucide-react";
import {
  QUALITY_SPECS, PHOTO_QUALITIES, estimateBytesPerCard, humanBytes,
  normalizePhotoPrefs, type PhotoPrefs, type PhotoQuality, type CropMode,
} from "@/lib/cards/photo-prefs";
import { resetPhotoPrefsCache } from "@/lib/cards/use-photo-prefs";

const box = "rounded-xl border border-hairline bg-white p-3";
const lbl = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink/50";

/**
 * Photo capture settings. The storage cost of every choice is shown HERE,
 * where the choice is made — not discovered later on a bill. Estimates are
 * labelled "about" because a JPEG's size depends on the card; the real number
 * is measured per image at upload.
 */
export function PhotoSettings({ initial }: { initial: Partial<PhotoPrefs> }) {
  const [p, setP] = useState<PhotoPrefs>(normalizePhotoPrefs(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [presets, setPresets] = useState<{ id: string; name: string; settings: PhotoPrefs }[]>([]);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetch("/api/cards/photo-presets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPresets(d?.presets ?? []))
      .catch(() => {}); // presets are a convenience; failing to list them must not break settings
  }, []);

  function set<K extends keyof PhotoPrefs>(k: K, v: PhotoPrefs[K]) {
    setP((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/prefs", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      // The camera caches prefs per page load; drop it so the next capture
      // uses what was just saved rather than what was loaded at boot.
      resetPhotoPrefsCache();
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save.");
    } finally { setBusy(false); }
  }

  async function savePreset() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cards/photo-presets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, settings: p }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save the preset.");
      setPresets((list) => [...list.filter((x) => x.name !== name), d.preset].sort((a, b) => a.name.localeCompare(b.name)));
      setNaming(false); setNewName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the preset.");
    } finally { setBusy(false); }
  }

  async function deletePreset(id: string) {
    setErr(null);
    const r = await fetch(`/api/cards/photo-presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setErr(d?.error || "Couldn't delete the preset.");
      return;
    }
    setPresets((list) => list.filter((x) => x.id !== id));
  }

  const perCard = estimateBytesPerCard(p, 2);
  const perGrading = estimateBytesPerCard(p, 12);

  return (
    <section className="mt-5 space-y-3">
      <div className="flex items-center gap-2">
        <Camera size={15} className="text-flag" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/50">Photos &amp; capture</h2>
      </div>

      {/* Quality — the setting that drives the storage bill. */}
      <div className={box}>
        <span className={lbl}>Photo quality</span>
        <div className="grid grid-cols-2 gap-1.5">
          {PHOTO_QUALITIES.map((q) => {
            const s = QUALITY_SPECS[q];
            const on = p.photo_quality === q;
            return (
              <button key={q} type="button" onClick={() => set("photo_quality", q as PhotoQuality)}
                className={"rounded-lg border px-2.5 py-2 text-left " + (on ? "border-flag bg-flag/10" : "border-hairline")}>
                <span className="block text-sm font-bold text-ink">{s.label}</span>
                <span className="block text-[10px] text-ink/50">{s.maxEdge}px · about {humanBytes(s.approxBytes)}</span>
                <span className="block text-[10px] text-ink/40">{s.note}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-ink/55">
          About <strong>{humanBytes(perCard)}</strong> per card at front+back
          {" · "}<strong>{humanBytes(perGrading)}</strong> for a 12-shot grading set.
          {" "}A thousand cards ≈ <strong>{humanBytes(perCard * 1000)}</strong>.
        </p>
      </div>

      {/* Cropping + originals — the integrity pair. */}
      <div className={box}>
        <span className={lbl}>Cropping</span>
        <div className="flex gap-1.5">
          {(["margin", "tight", "off"] as CropMode[]).map((m) => (
            <button key={m} type="button" onClick={() => set("auto_crop", m)}
              className={"flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold " +
                (p.auto_crop === m ? "border-flag bg-flag/10 text-ink" : "border-hairline text-ink/60")}>
              {m === "margin" ? "With margin" : m === "tight" ? "Tight" : "None"}
            </button>
          ))}
        </div>
        {p.auto_crop === "tight" && (
          <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            A tight crop puts the card&apos;s edge on the image boundary, so chipping can&apos;t be judged from the photo.
          </p>
        )}
        {p.auto_crop === "margin" && (
          <label className="mt-2 block">
            <span className="text-[11px] text-ink/55">Margin around the card: <strong>{(p.crop_margin_pct * 100).toFixed(1)}%</strong> (≈{(p.crop_margin_pct * 63.5).toFixed(1)}mm)</span>
            <input type="range" min={0.005} max={0.15} step={0.005} value={p.crop_margin_pct}
              onChange={(e) => set("crop_margin_pct", Number(e.target.value))} className="mt-1 w-full accent-flag" />
          </label>
        )}
        <label className="mt-3 flex items-start gap-2">
          <input type="checkbox" checked={p.keep_originals} onChange={(e) => set("keep_originals", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-flag" />
          <span className="text-[11px] text-ink/70">
            Keep the uncropped photo too
            <span className="block text-ink/45">Doubles storage. Without it, a crop is the only record of the card&apos;s edges.</span>
          </span>
        </label>
        {!p.keep_originals && (
          <p className="mt-1.5 flex gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800">
            <AlertTriangle size={13} className="mt-px shrink-0" />
            Originals off — you won&apos;t be able to prove an edge wasn&apos;t cropped away. This change is recorded.
          </p>
        )}
      </div>

      {/* Capture behaviour. */}
      <div className={box}>
        <span className={lbl}>Capture</span>
        <div className="flex gap-1.5">
          {(["in_app", "os_camera"] as const).map((m) => (
            <button key={m} type="button" onClick={() => set("capture_mode", m)}
              className={"flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold " +
                (p.capture_mode === m ? "border-flag bg-flag/10 text-ink" : "border-hairline text-ink/60")}>
              {m === "in_app" ? "In-app scanner" : "Phone camera"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-ink/45">
          {p.capture_mode === "in_app"
            ? "Guide frame, auto-snap and edge margin. Best for batches."
            : "Uses your phone's camera app — better HDR and low light, but no guide or auto-snap."}
        </p>
        {p.capture_mode === "in_app" && (
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" checked={p.scan_on_open}
              onChange={(e) => set("scan_on_open", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-flag" />
            <span className="text-[11px] text-ink/70">
              Start scanning as soon as the viewfinder is live
              <span className="block text-ink/45">
                Off by default: the camera opens so you can line the card up, and a
                <strong> Start scan</strong> button waits at the bottom. Detection, the
                distance readout and auto-snap all hold until you tap it — so they
                aren&apos;t measuring your lap on the way to the card.
              </span>
            </span>
          </label>
        )}
        {p.capture_mode === "in_app" && (
          <>
            <label className="mt-3 flex items-start gap-2">
              <input type="checkbox" checked={p.auto_snap} onChange={(e) => set("auto_snap", e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-flag" />
              <span className="text-[11px] text-ink/70">
                Snap automatically when the card is sharp and still
                <span className="block text-ink/45">Hands-free for working through a stack.</span>
              </span>
            </label>
            <label className="mt-2 block">
              <span className="text-[11px] text-ink/55">Frames per shot: <strong>{p.burst_count}</strong> (keeps the sharpest)</span>
              <input type="range" min={1} max={5} step={1} value={p.burst_count}
                onChange={(e) => set("burst_count", Number(e.target.value))} className="mt-1 w-full accent-flag" />
            </label>
          </>
        )}
      </div>

      {/* Named bundles — "bulk intake" vs "consignment quality" in one tap.
          Applying one only fills the form; nothing changes until you save. */}
      <div className={box}>
        <span className={lbl}>Presets</span>
        {presets.length > 0 ? (
          <ul className="space-y-1">
            {presets.map((x) => (
              <li key={x.id} className="flex items-center gap-2">
                <button type="button" onClick={() => { setP(x.settings); setSaved(false); }}
                  className="flex flex-1 items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-left text-[11px] font-semibold text-ink">
                  <Bookmark size={12} className="text-flag" /> {x.name}
                  <span className="ml-auto font-normal text-ink/45">
                    {QUALITY_SPECS[x.settings.photo_quality].label} · {humanBytes(estimateBytesPerCard(x.settings, 2))}/card
                  </span>
                </button>
                <button type="button" onClick={() => deletePreset(x.id)} aria-label={`Delete ${x.name}`}
                  className="rounded-lg p-1.5 text-ink/35 hover:text-danger">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-ink/45">None yet. Save the settings above as a named bundle you can switch back to.</p>
        )}
        {naming ? (
          <div className="mt-2 flex gap-1.5">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={60}
              placeholder="Bulk intake" className="flex-1 rounded-lg border border-hairline px-2.5 py-1.5 text-sm text-ink outline-none focus:border-flag" />
            <button type="button" onClick={savePreset} disabled={busy || !newName.trim()}
              className="rounded-lg bg-flag px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">Save</button>
            <button type="button" onClick={() => { setNaming(false); setNewName(""); }}
              className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-ink/50">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setNaming(true)}
            className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-flag">
            <Plus size={13} /> Save these as a preset
          </button>
        )}
      </div>

      {err && <p className="text-xs text-danger">{err}</p>}
      <button onClick={save} disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-flag py-3 font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
        {busy ? "Saving…" : saved ? "Saved" : "Save photo settings"}
      </button>
    </section>
  );
}
