// The eBay wordmark in its own colors — e·red, b·blue, a·yellow, y·green
// (official brand hexes). Lowercase, as the real logo is. Sizing/leading come
// from the caller via className (e.g. "text-sm").
const LETTERS: readonly [string, string][] = [
  ["e", "#E53238"],
  ["b", "#0064D2"],
  ["a", "#F5AF02"],
  ["y", "#86B817"],
];

export function EbayLogo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="eBay"
      className={"font-extrabold tracking-tight " + className}
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {LETTERS.map(([ch, color]) => (
        <span key={ch} style={{ color }} aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  );
}
