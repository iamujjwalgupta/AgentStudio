import {
  formatCompact,
  formatValue,
  type Chart,
  type Deliverable,
  type Fmt,
  type Table,
  type Tone,
} from "./deliverable";

/**
 * A presented result as files: an Excel workbook, a PDF report and a
 * PowerPoint deck. All three read the same stored result as the dashboard, so
 * they always show the same figures.
 */

const NAVY = "00338D";
const NAVY_DARK = "001F5C";
const SKY = "0091DA";
const MUTED = "516A92";
const LINE = "D9E1EE";
const ZEBRA = "F6F8FC";
const COLOURS = ["00338D", "0091DA", "00A3A1", "483698", "C6007E", "F68D2E"];
const TONE_COLOUR: Record<Tone, string> = { good: "00A3A1", bad: "D1345B", warn: "D68910", neutral: NAVY };

const isNumeric = (f?: Fmt) => f === "currency" || f === "number" || f === "integer" || f === "percent";
const toNum = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/* ── Excel ──────────────────────────────────────────────────────────────── */

function excelFormat(f: Fmt | undefined, currency: string): string | undefined {
  switch (f) {
    case "currency":
      return currency === "INR"
        ? '[>=10000000]"₹"#\\,##\\,##\\,##0.00;[>=100000]"₹"#\\,##\\,##0.00;"₹"#,##0.00'
        : currency === "USD"
          ? '"$"#,##0.00'
          : `#,##0.00 "${currency}"`;
    case "number":
      return "#,##0.00";
    case "integer":
      return "#,##0";
    case "percent":
      return "0.0%";
    case "date":
      return "dd-mmm-yyyy";
    default:
      return undefined;
  }
}

function excelValue(v: any, f: Fmt | undefined): any {
  if (v === null || v === undefined || v === "") return null;
  if (f === "date") {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d;
  }
  if (isNumeric(f)) {
    const n = toNum(v);
    if (n === null) return String(v);
    return f === "percent" && Math.abs(n) > 1 ? n / 100 : n;
  }
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

/** Sheet names: at most 31 characters, none of \ / ? * [ ] :, unique. */
function sheetNames(titles: string[]): string[] {
  const used = new Set<string>(["summary", "chart data"]);
  return titles.map((t) => {
    const base = (t.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Table").slice(0, 28);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 25)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export async function deliverableToXlsx(d: Deliverable): Promise<Buffer> {
  const ExcelJS: any = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Agent Studio";
  wb.created = new Date();
  const header = (row: any) => {
    row.eachCell((c: any) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${NAVY}` } };
      c.alignment = { vertical: "middle" };
      c.border = { bottom: { style: "thin", color: { argb: `FF${NAVY_DARK}` } } };
    });
    row.height = 20;
  };

  // Summary
  const s = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  s.columns = [{ width: 34 }, { width: 26 }, { width: 60 }];
  s.mergeCells("A1:C1");
  s.getCell("A1").value = d.title;
  s.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  s.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${NAVY}` } };
  s.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  s.getRow(1).height = 30;
  let r = 2;
  if (d.subtitle) {
    s.mergeCells(`A${r}:C${r}`);
    s.getCell(`A${r}`).value = d.subtitle;
    s.getCell(`A${r}`).font = { italic: true, color: { argb: `FF${MUTED}` } };
    r++;
  }
  s.getCell(`A${r}`).value = `Generated ${new Date(d.generatedAt).toLocaleString("en-GB")}${d.sources.length ? ` · Sources: ${d.sources.join(", ")}` : ""}`;
  s.getCell(`A${r}`).font = { size: 9, color: { argb: `FF${MUTED}` } };
  r += 2;
  if (d.summary) {
    s.mergeCells(`A${r}:C${r}`);
    const c = s.getCell(`A${r}`);
    c.value = d.summary;
    c.alignment = { wrapText: true, vertical: "top" };
    s.getRow(r).height = Math.min(120, 15 * Math.ceil(d.summary.length / 110));
    r += 2;
  }
  if (d.kpis.length) {
    s.getCell(`A${r}`).value = "Headline figures";
    s.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: `FF${NAVY}` } };
    r++;
    const hr = s.getRow(r);
    hr.values = ["Figure", "Value", "Note"];
    header(hr);
    r++;
    for (const k of d.kpis) {
      const row = s.getRow(r++);
      row.values = [k.label, excelValue(k.value, k.format), k.note ?? ""];
      const fmt = excelFormat(k.format, d.currency);
      if (fmt) row.getCell(2).numFmt = fmt;
      row.getCell(2).font = { bold: true, color: { argb: `FF${TONE_COLOUR[k.tone ?? "neutral"]}` } };
      row.getCell(2).alignment = { horizontal: "right" };
    }
    r++;
  }
  for (const [title, items] of [
    ["Findings", d.findings.map((f) => [f.tone === "neutral" ? "Note" : f.tone === "good" ? "Good" : f.tone === "bad" ? "Problem" : "Watch", f.title, f.detail ?? ""])],
    ["Next actions", d.actions.map((a, i) => [`${i + 1}.`, a.text, a.owner ?? ""])],
  ] as const) {
    if (!items.length) continue;
    s.getCell(`A${r}`).value = title;
    s.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: `FF${NAVY}` } };
    r++;
    for (const it of items) {
      const row = s.getRow(r++);
      row.values = [...it];
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    }
    r++;
  }

  // One sheet per table
  const names = sheetNames(d.tables.map((t) => t.title));
  d.tables.forEach((t, ti) => {
    const ws = wb.addWorksheet(names[ti], { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = t.columns.map((c) => {
      const longest = Math.max(c.label.length, ...t.rows.slice(0, 200).map((row) => formatValue(row[c.key], c.format, d.currency).length));
      return { header: c.label, key: c.key, width: Math.min(Math.max(longest + 2, 10), 50) };
    });
    header(ws.getRow(1));
    for (const row of t.rows) ws.addRow(t.columns.map((c) => excelValue(row[c.key], c.format)));
    t.columns.forEach((c, ci) => {
      const fmt = excelFormat(c.format, d.currency);
      const col = ws.getColumn(ci + 1);
      if (fmt) col.numFmt = fmt;
      if (isNumeric(c.format)) col.alignment = { horizontal: "right" };
    });
    for (let i = 2; i <= t.rows.length + 1; i++) {
      if (i % 2 === 1) ws.getRow(i).eachCell({ includeEmpty: true }, (cell: any) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${ZEBRA}` } }));
    }
    // A total under every money column.
    const money = t.columns.map((c, i) => (c.format === "currency" ? i : -1)).filter((i) => i >= 0);
    if (money.length && t.rows.length > 1) {
      const last = t.rows.length + 1;
      const totals: any[] = t.columns.map(() => null);
      if (!money.includes(0)) totals[0] = "Total";
      const tr = ws.addRow(totals);
      for (const i of money) {
        const letter = ws.getColumn(i + 1).letter;
        tr.getCell(i + 1).value = { formula: `SUM(${letter}2:${letter}${last})` };
      }
      tr.font = { bold: true };
      tr.eachCell({ includeEmpty: true }, (cell: any) => (cell.border = { top: { style: "thin", color: { argb: `FF${NAVY}` } } }));
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
    if (t.note || t.truncated) {
      const nr = ws.addRow([]);
      ws.addRow([t.truncated ? `First ${t.rows.length} of ${t.truncated}+ rows.` : t.note]).font = { italic: true, color: { argb: `FF${MUTED}` } };
      void nr;
    }
  });

  // Chart data, for anyone who wants to chart it their own way
  if (d.charts.length) {
    const cs = wb.addWorksheet("Chart data");
    let cr = 1;
    for (const c of d.charts) {
      cs.getCell(cr, 1).value = c.title;
      cs.getCell(cr, 1).font = { bold: true, size: 12, color: { argb: `FF${NAVY}` } };
      cr++;
      const hr = cs.getRow(cr);
      hr.values = ["", ...c.series.map((x) => x.name)];
      header(hr);
      cr++;
      c.categories.forEach((cat, i) => {
        const row = cs.getRow(cr++);
        row.values = [cat, ...c.series.map((x) => x.values[i])];
        const fmt = excelFormat(c.format, d.currency);
        if (fmt) c.series.forEach((_, j) => (row.getCell(j + 2).numFmt = fmt));
      });
      cr += 2;
    }
    cs.getColumn(1).width = 34;
    for (let j = 2; j <= 7; j++) cs.getColumn(j).width = 20;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ── PDF ────────────────────────────────────────────────────────────────── */

/** The PDF's built-in fonts cover Latin-1 (and a few marks) only; ₹ becomes INR. */
function pdfText(s: string): string {
  return String(s ?? "")
    .replace(/₹\s?/g, "INR ")
    .replace(/[→⟶]/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[✓✔]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰‹Œ‘’“”•–—˜™›œŸ]/g, "");
}

const hex = (c: string) => `#${c}`;

export async function deliverableToPdf(d: Deliverable): Promise<Buffer> {
  const PDFDocument: any = (await import("pdfkit")).default ?? (await import("pdfkit"));
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: d.title, Producer: "Agent Studio" } });
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const W = doc.page.width, H = doc.page.height, M = 36;
  const CW = W - 2 * M;
  const bottom = () => H - M - 18;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const heading = (t: string) => {
    ensure(40);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(hex(NAVY)).text(pdfText(t), M, doc.y);
    doc.moveDown(0.3);
  };

  // Cover band
  doc.rect(0, 0, W, 108).fill(hex(NAVY));
  doc.rect(0, 104, W, 4).fill(hex(SKY));
  doc.fillColor("#9FD5F2").font("Helvetica").fontSize(9).text("AGENT RESULT", M, 26, { characterSpacing: 1.5 });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(22).text(pdfText(d.title), M, 40, { width: CW });
  if (d.subtitle) doc.fillColor("#CFE2FF").font("Helvetica").fontSize(11).text(pdfText(d.subtitle), M, doc.y + 2, { width: CW });
  doc
    .fillColor("#B9CDF0")
    .fontSize(9)
    .text(pdfText(`${new Date(d.generatedAt).toLocaleString("en-GB")}${d.sources.length ? "   ·   " + d.sources.join("   ·   ") : ""}`), M, 88, { width: CW });
  doc.y = 126;

  if (d.summary) {
    doc.font("Helvetica").fontSize(10.5).fillColor("#2C4372").text(pdfText(d.summary), M, doc.y, { width: CW, lineGap: 2 });
    doc.moveDown(0.8);
  }

  // Headline figures
  if (d.kpis.length) {
    const per = Math.min(d.kpis.length, 4);
    const gap = 10, tw = (CW - gap * (per - 1)) / per, th = 62;
    for (let i = 0; i < d.kpis.length; i += per) {
      ensure(th + 10);
      const y = doc.y;
      d.kpis.slice(i, i + per).forEach((k, j) => {
        const x = M + j * (tw + gap);
        doc.roundedRect(x, y, tw, th, 6).lineWidth(0.8).strokeColor(hex(LINE)).fillAndStroke("#FFFFFF", hex(LINE));
        doc.rect(x, y, 4, th).fill(hex(TONE_COLOUR[k.tone ?? "neutral"]));
        doc.fillColor(hex(MUTED)).font("Helvetica").fontSize(8).text(pdfText(k.label.toUpperCase()), x + 12, y + 9, { width: tw - 20, characterSpacing: 0.4 });
        doc.fillColor(hex(k.tone === "bad" ? "A3243F" : k.tone === "good" ? "007B79" : k.tone === "warn" ? "9A5B00" : NAVY_DARK))
          .font("Helvetica-Bold")
          .fontSize(16)
          .text(pdfText(formatValue(k.value, k.format, d.currency)), x + 12, y + 22, { width: tw - 20 });
        if (k.note) doc.fillColor(hex(MUTED)).font("Helvetica").fontSize(7.5).text(pdfText(k.note), x + 12, y + 44, { width: tw - 20, height: 14, ellipsis: true });
      });
      doc.y = y + th + 10;
    }
  }

  // Charts, two to a row
  if (d.charts.length) {
    heading("Charts");
    const gap = 14, cw = d.charts.length === 1 ? CW : (CW - gap) / 2, ch = 200;
    for (let i = 0; i < d.charts.length; i += 2) {
      ensure(ch + 24);
      const y = doc.y;
      d.charts.slice(i, i + 2).forEach((c, j) => drawPdfChart(doc, c, d.currency, M + j * (cw + gap), y, d.charts.length === 1 ? CW : cw, ch));
      doc.y = y + ch + 14;
    }
  }

  // Findings and actions
  for (const [title, items] of [
    ["Findings", d.findings.map((f) => ({ colour: TONE_COLOUR[f.tone], head: f.title, body: f.detail }))],
    ["Next actions", d.actions.map((a, i) => ({ colour: NAVY, head: `${i + 1}. ${a.text}`, body: a.owner ? `Owner: ${a.owner}` : undefined }))],
  ] as const) {
    if (!items.length) continue;
    heading(title);
    for (const it of items) {
      ensure(30);
      const y = doc.y;
      doc.circle(M + 4, y + 5, 3).fill(hex(it.colour));
      doc.fillColor("#0A1B3D").font("Helvetica-Bold").fontSize(10).text(pdfText(it.head), M + 14, y, { width: CW - 14 });
      if (it.body) doc.fillColor(hex(MUTED)).font("Helvetica").fontSize(9).text(pdfText(it.body), M + 14, doc.y + 1, { width: CW - 14 });
      doc.moveDown(0.4);
    }
  }

  // Tables
  for (const t of d.tables) {
    // A table's heading travels with its first few rows.
    ensure(40 + 18 * Math.min(Math.max(t.rows.length, 1) + 1, 4));
    heading(`${t.title} (${t.rows.length}${t.truncated ? `+` : ""})`);
    drawPdfTable(doc, t, d.currency, M, CW, bottom);
    if (t.note) doc.fillColor(hex(MUTED)).font("Helvetica-Oblique").fontSize(8.5).text(pdfText(t.note), M, doc.y + 4, { width: CW });
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // The footer sits in the bottom margin; with the margin in force, pdfkit
    // would start a new page for it.
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(hex(MUTED)).font("Helvetica").fontSize(8);
    doc.text(pdfText(`${d.title}  ·  Agent Studio`), M, H - M + 6, { width: CW / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M + CW / 2, H - M + 6, { width: CW / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}

function drawPdfChart(doc: any, c: Chart, currency: string, x: number, y: number, w: number, h: number) {
  doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).strokeColor(hex(LINE)).stroke();
  doc.fillColor("#0A1B3D").font("Helvetica-Bold").fontSize(10).text(pdfText(c.title), x + 10, y + 8, { width: w - 20, height: 14, ellipsis: true });
  const top = y + 28;
  if (c.kind === "donut") {
    const values = (c.series[0]?.values ?? []).map((v) => Math.max(v, 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const R = Math.min(h - 50, 140) / 2, r = R * 0.62, cx = x + 14 + R, cy = top + 8 + R;
    let a0 = -Math.PI / 2;
    values.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      if (sweep <= 0) return;
      const a1 = a0 + Math.min(sweep, Math.PI * 2 - 1e-4);
      const large = sweep > Math.PI ? 1 : 0;
      const p = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
      doc.path(`M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`).fill(hex(COLOURS[i % COLOURS.length]));
      a0 += sweep;
    });
    doc.fillColor(hex(NAVY_DARK)).font("Helvetica-Bold").fontSize(11).text(pdfText(formatCompact(total, c.format, currency)), cx - R, cy - 6, { width: 2 * R, align: "center" });
    let ly = top + 6;
    const lx = cx + R + 18, lw = x + w - lx - 10;
    c.categories.forEach((cat, i) => {
      if (ly > y + h - 14) return;
      doc.rect(lx, ly + 2, 7, 7).fill(hex(COLOURS[i % COLOURS.length]));
      doc.fillColor("#2C4372").font("Helvetica").fontSize(8)
        .text(pdfText(`${cat}  ${formatValue(values[i], c.format, currency)}  (${Math.round((values[i] / total) * 1000) / 10}%)`), lx + 12, ly, { width: lw, height: 11, ellipsis: true });
      ly += 14;
    });
    return;
  }
  const L = x + 52, Rx = x + w - 12, T = top + 4, B = y + h - (c.categories.length > 6 ? 40 : 24);
  const all = c.series.flatMap((s) => s.values);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const step = (() => {
    const raw = span / 4, pow = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  })();
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const yOf = (v: number) => B - ((v - lo) / (hi - lo || 1)) * (B - T);
  for (let v = lo; v <= hi + step * 1e-3; v += step) {
    doc.moveTo(L, yOf(v)).lineTo(Rx, yOf(v)).lineWidth(0.5).strokeColor(v === 0 ? "#B8C4D8" : "#E8EDF5").stroke();
    doc.fillColor("#6A7FA6").font("Helvetica").fontSize(7).text(pdfText(formatCompact(v, c.format, currency)), x + 4, yOf(v) - 4, { width: L - x - 8, align: "right" });
  }
  const n = Math.max(c.categories.length, 1), band = (Rx - L) / n;
  if (c.kind === "bar") {
    const m = c.series.length, gw = band * 0.72, bw = gw / m;
    c.categories.forEach((_, i) =>
      c.series.forEach((s, j) => {
        const v = s.values[i] ?? 0, bx = L + i * band + (band - gw) / 2 + j * bw;
        const y1 = yOf(Math.max(v, 0)), y2 = yOf(Math.min(v, 0));
        doc.rect(bx + 0.5, y1, Math.max(bw - 1, 1), Math.max(y2 - y1, 0.5)).fill(hex(COLOURS[j % COLOURS.length]));
      }),
    );
  } else {
    c.series.forEach((s, j) => {
      s.values.forEach((v, i) => {
        const px = L + i * band + band / 2, py = yOf(v);
        if (i === 0) doc.moveTo(px, py);
        else doc.lineTo(px, py);
      });
      doc.lineWidth(1.6).strokeColor(hex(COLOURS[j % COLOURS.length])).stroke();
      s.values.forEach((v, i) => doc.circle(L + i * band + band / 2, yOf(v), 2).fill(hex(COLOURS[j % COLOURS.length])));
    });
  }
  const rotate = c.categories.length > 6;
  c.categories.forEach((cat, i) => {
    const cx = L + i * band + band / 2;
    const label = pdfText(cat.length > 14 ? cat.slice(0, 13) + "…" : cat);
    if (rotate) {
      doc.save().rotate(-35, { origin: [cx, B + 6] });
      doc.fillColor("#6A7FA6").font("Helvetica").fontSize(6.5).text(label, cx - 60, B + 3, { width: 60, align: "right", lineBreak: false });
      doc.restore();
    } else {
      doc.fillColor("#6A7FA6").font("Helvetica").fontSize(7).text(label, cx - band / 2, B + 5, { width: band, align: "center", lineBreak: false });
    }
  });
}

function drawPdfTable(doc: any, t: Table, currency: string, x: number, width: number, bottom: () => number) {
  if (!t.rows.length) {
    doc.fillColor(hex(MUTED)).font("Helvetica").fontSize(9).text("Nothing to show.", x, doc.y);
    return;
  }
  const size = 8, pad = 5, rowH = 16;
  const cell = (row: any, c: Table["columns"][number]) => pdfText(formatValue(row[c.key], c.format, currency));
  // Widths from the content, scaled to the page.
  doc.font("Helvetica").fontSize(size);
  const natural = t.columns.map((c) => {
    const sample = t.rows.slice(0, 60).map((row) => doc.widthOfString(cell(row, c)));
    doc.font("Helvetica-Bold");
    const head = doc.widthOfString(pdfText(c.label.toUpperCase()));
    doc.font("Helvetica");
    return Math.min(Math.max(head, ...sample) + pad * 2, 220);
  });
  const total = natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => (w / total) * width);
  const fit = (s: string, w: number) => {
    if (doc.widthOfString(s) <= w) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (doc.widthOfString(s.slice(0, mid) + "…") <= w) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + "…";
  };
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(x, y, width, rowH + 2).fill(hex(NAVY));
    let cx = x;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
    t.columns.forEach((c, i) => {
      doc.text(fit(pdfText(c.label.toUpperCase()), widths[i] - pad * 2), cx + pad, y + 5, {
        width: widths[i] - pad * 2,
        align: isNumeric(c.format) ? "right" : "left",
        lineBreak: false,
      });
      cx += widths[i];
    });
    doc.y = y + rowH + 2;
  };
  if (doc.y + rowH * 3 > bottom()) doc.addPage();
  drawHeader();
  t.rows.forEach((row, ri) => {
    if (doc.y + rowH > bottom()) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (ri % 2 === 1) doc.rect(x, y, width, rowH).fill(hex(ZEBRA));
    let cx = x;
    doc.font("Helvetica").fontSize(size).fillColor("#0A1B3D");
    t.columns.forEach((c, i) => {
      doc.text(fit(cell(row, c), widths[i] - pad * 2), cx + pad, y + 4.5, {
        width: widths[i] - pad * 2,
        align: isNumeric(c.format) ? "right" : "left",
        lineBreak: false,
      });
      cx += widths[i];
    });
    doc.moveTo(x, y + rowH).lineTo(x + width, y + rowH).lineWidth(0.4).strokeColor("#EDF1F7").stroke();
    doc.y = y + rowH;
  });
  if (t.truncated) doc.fillColor(hex(MUTED)).font("Helvetica-Oblique").fontSize(8).text(`First ${t.rows.length} of ${t.truncated}+ rows. The full list is in the Excel download.`, x, doc.y + 4, { width });
  doc.moveDown(0.6);
}

/* ── PowerPoint ─────────────────────────────────────────────────────────── */

export async function deliverableToPptx(d: Deliverable): Promise<Buffer> {
  const mod: any = await import("pptxgenjs");
  const PptxGenJS = mod.default ?? mod;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.title = d.title;
  pptx.company = "Agent Studio";
  const FONT = "Calibri";
  pptx.defineSlideMaster({
    title: "AS",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.1, fill: { color: NAVY } } },
      { text: { text: `${d.title}  ·  Agent Studio`, options: { x: 0.4, y: 7.05, w: 9, h: 0.3, fontSize: 9, color: "7C90B3", fontFace: FONT } } },
    ],
    slideNumber: { x: 12.5, y: 7.05, w: 0.5, h: 0.3, fontSize: 9, color: "7C90B3", fontFace: FONT },
  });
  const title = (slide: any, text: string, sub?: string) => {
    slide.addText(text, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 24, bold: true, color: NAVY_DARK, fontFace: FONT });
    if (sub) slide.addText(sub, { x: 0.5, y: 0.85, w: 12.3, h: 0.35, fontSize: 12, color: MUTED, fontFace: FONT });
  };

  // Title slide
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 5.6, w: 13.33, h: 0.08, fill: { color: SKY }, line: { color: SKY } });
  cover.addText("AGENT RESULT", { x: 0.8, y: 1.9, w: 11, h: 0.4, fontSize: 12, color: "9FD5F2", charSpacing: 4, fontFace: FONT });
  cover.addText(d.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.4, fontSize: 40, bold: true, color: "FFFFFF", fontFace: FONT, valign: "top" });
  if (d.subtitle) cover.addText(d.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.6, fontSize: 18, color: "CFE2FF", fontFace: FONT });
  cover.addText(`${new Date(d.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}${d.sources.length ? "   ·   " + d.sources.join("   ·   ") : ""}`, {
    x: 0.8, y: 5.85, w: 11.7, h: 0.4, fontSize: 12, color: "B9CDF0", fontFace: FONT,
  });

  // Headline figures (and the summary)
  if (d.kpis.length || d.summary) {
    const s = pptx.addSlide({ masterName: "AS" });
    title(s, "At a glance");
    const per = Math.min(Math.max(d.kpis.length, 1), 4);
    const gap = 0.25, tw = (12.3 - gap * (per - 1)) / per, th = 1.5;
    d.kpis.forEach((k, i) => {
      const row = Math.floor(i / per), col = i % per;
      const x = 0.5 + col * (tw + gap), y = 1.35 + row * (th + 0.25);
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: tw, h: th, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: LINE, width: 1 } });
      s.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h: th, fill: { color: TONE_COLOUR[k.tone ?? "neutral"] }, line: { color: TONE_COLOUR[k.tone ?? "neutral"] } });
      s.addText(k.label.toUpperCase(), { x: x + 0.25, y: y + 0.12, w: tw - 0.4, h: 0.35, fontSize: 11, color: MUTED, fontFace: FONT });
      s.addText(formatValue(k.value, k.format, d.currency), { x: x + 0.25, y: y + 0.45, w: tw - 0.4, h: 0.6, fontSize: 24, bold: true, color: k.tone === "bad" ? "A3243F" : k.tone === "good" ? "007B79" : NAVY_DARK, fontFace: FONT, fit: "shrink" });
      if (k.note) s.addText(k.note, { x: x + 0.25, y: y + 1.05, w: tw - 0.4, h: 0.35, fontSize: 10, color: MUTED, fontFace: FONT });
    });
    if (d.summary) {
      const rows = Math.ceil(d.kpis.length / per);
      s.addText(d.summary, { x: 0.5, y: 1.4 + rows * 1.75, w: 12.3, h: 1.6, fontSize: 14, color: "2C4372", fontFace: FONT, valign: "top", fill: { color: "F3F7FD" }, margin: 12 });
    }
  }

  // One native chart per slide
  for (const c of d.charts) {
    const s = pptx.addSlide({ masterName: "AS" });
    title(s, c.title, c.note);
    const type = c.kind === "donut" ? pptx.ChartType.doughnut : c.kind === "line" ? pptx.ChartType.line : pptx.ChartType.bar;
    const fmtCode = c.format === "currency" ? (d.currency === "INR" ? '"₹"#,##0' : '#,##0') : c.format === "percent" ? "0%" : "#,##0";
    s.addChart(
      type,
      c.series.map((x) => ({ name: x.name, labels: c.categories, values: x.values })),
      {
        x: 0.5, y: 1.3, w: 12.3, h: 5.5,
        chartColors: COLOURS,
        barDir: "col",
        holeSize: 58,
        showLegend: c.kind === "donut" || c.series.length > 1,
        legendPos: c.kind === "donut" ? "r" : "b",
        legendFontSize: 11,
        showPercent: c.kind === "donut",
        showValue: c.kind !== "donut" && c.categories.length * c.series.length <= 12,
        dataLabelFormatCode: fmtCode,
        dataLabelFontSize: 10,
        valAxisLabelFormatCode: fmtCode,
        valAxisLabelFontSize: 10,
        catAxisLabelFontSize: 10,
        valGridLine: { color: "E8EDF5", size: 0.75 },
        lineSize: 2,
        lineDataSymbolSize: 6,
      },
    );
  }

  // Findings and actions
  if (d.findings.length || d.actions.length) {
    const s = pptx.addSlide({ masterName: "AS" });
    title(s, "Findings and next actions");
    const both = d.findings.length && d.actions.length;
    const colW = both ? 6 : 12.3;
    if (d.findings.length) {
      s.addText(
        d.findings.flatMap((f) => [
          { text: f.title, options: { bold: true, color: TONE_COLOUR[f.tone], bullet: { code: "25CF" }, breakLine: true } },
          ...(f.detail ? [{ text: f.detail, options: { color: "2C4372", fontSize: 12, indentLevel: 1, breakLine: true } }] : []),
        ]),
        { x: 0.5, y: 1.3, w: colW, h: 5.6, fontSize: 14, fontFace: FONT, valign: "top", paraSpaceAfter: 6 },
      );
    }
    if (d.actions.length) {
      s.addText(
        d.actions.map((a) => ({ text: `${a.text}${a.owner ? `  (${a.owner})` : ""}`, options: { bullet: { type: "number" }, color: "0A1B3D", breakLine: true } })),
        { x: both ? 6.8 : 0.5, y: 1.3, w: both ? 6 : 12.3, h: 5.6, fontSize: 14, fontFace: FONT, valign: "top", paraSpaceAfter: 8 },
      );
    }
  }

  // Tables, a page of rows per slide (a few slides at most; Excel has the rest)
  const PER = 12, MAX_SLIDES = 4;
  for (const t of d.tables) {
    const pages = Math.max(1, Math.min(Math.ceil(t.rows.length / PER), MAX_SLIDES));
    for (let p = 0; p < pages; p++) {
      const s = pptx.addSlide({ masterName: "AS" });
      title(s, pages > 1 ? `${t.title} (${p + 1}/${pages})` : t.title, `${t.rows.length}${t.truncated ? "+" : ""} rows${t.rows.length > PER * MAX_SLIDES ? " · the full list is in the Excel download" : ""}`);
      const head = t.columns.map((c) => ({
        text: c.label,
        options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: isNumeric(c.format) ? "right" : "left" },
      }));
      const body = t.rows.slice(p * PER, (p + 1) * PER).map((row, ri) =>
        t.columns.map((c) => ({
          text: formatValue(row[c.key], c.format, d.currency),
          options: { align: isNumeric(c.format) ? "right" : "left", fill: { color: ri % 2 ? ZEBRA : "FFFFFF" } },
        })),
      );
      s.addTable(t.rows.length ? [head, ...body] : [head, [{ text: "Nothing to show.", options: { colspan: t.columns.length || 1 } }]], {
        x: 0.5, y: 1.35, w: 12.3, fontSize: t.columns.length > 8 ? 9 : 11, fontFace: FONT, color: "0A1B3D",
        border: { type: "solid", pt: 0.5, color: LINE }, autoPage: false, rowH: 0.36,
      });
    }
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
