// ZPL for a 1.5"W x 1"L label on a Zebra ZD411 (203 dpi → 305 x 203 dots).
// QR encodes the card URL (scan → opens the card); SKU + title printed beside.
export function buildLabelZpl(opts: { url: string; sku: string; title: string }): string {
  const clean = (s: string) => s.replace(/[\^~,]/g, " ");
  const sku = clean(opts.sku);
  const title = clean(opts.title).slice(0, 24);
  return [
    "^XA",
    "^CI28", // UTF-8
    "^PW305", // 1.5in @ 203dpi
    "^LL203", // 1in @ 203dpi
    `^FO12,26^BQN,2,4^FDMA,${opts.url}^FS`, // QR (magnification 4)
    `^FO172,30^A0N,26,26^FD${sku}^FS`,
    `^FO172,66^A0N,18,18^FB130,2,0,L,0^FD${title}^FS`,
    "^XZ",
  ].join("\n");
}
