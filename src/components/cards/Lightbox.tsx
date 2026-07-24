"use client";

import { useState } from "react";
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

/**
 * Full-screen photo viewer with zoom (Beau, 2026-07-19): tap a thumbnail →
 * this. Double-tap toggles 1x ↔ 2.5x; +/− steps to 4x; drag/scroll to pan
 * while zoomed; X or tapping the backdrop closes.
 */
export function Lightbox({ src, alt = "photo", onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const step = (d: number) => setZoom((z) => Math.min(4, Math.max(1, Math.round((z + d) * 4) / 4)));

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" style={{ colorScheme: "dark" }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="flex items-center gap-1 rounded-lg border border-white/20 text-sm">
          <button onClick={() => step(-0.75)} className="p-1.5 hover:bg-white/10" aria-label="Zoom out"><ZoomOut size={16} /></button>
          <button onClick={() => setZoom(1)} className="figures px-1 text-xs text-white/70" title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button onClick={() => step(0.75)} className="p-1.5 hover:bg-white/10" aria-label="Zoom in"><ZoomIn size={16} /></button>
        </span>
        <span className="flex items-center gap-2">
          <button onClick={() => setZoom((z) => (z === 1 ? 2.5 : 1))} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" title="Toggle zoom">
            <Maximize2 size={18} />
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close"><X size={22} /></button>
        </span>
      </div>
      <div
        className="flex-1 overflow-auto overscroll-contain"
        onDoubleClick={() => setZoom((z) => (z === 1 ? 2.5 : 1))}
        onClick={(e) => { if (e.target === e.currentTarget && zoom === 1) onClose(); }}
      >
        {zoom === 1 ? (
          <div className="flex h-full w-full items-center justify-center p-2" onClick={() => onClose()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="max-h-full max-w-full object-contain"
              onClick={(e) => { e.stopPropagation(); setZoom(2.5); }} />
          </div>
        ) : (
          <div style={{ width: `${zoom * 100}%` }} className="min-h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} style={{ width: "100%" }} draggable={false} />
          </div>
        )}
      </div>
      <p className="pb-2 text-center text-[10px] text-white/40">double-tap to zoom · drag to pan · tap outside to close</p>
    </div>
  );
}
