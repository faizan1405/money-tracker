import { StatementParseError } from "./parse.js";

/**
 * Extracts text from a PDF in memory (nothing is written to disk or sent anywhere).
 * Text items are grouped into lines by their vertical position so table rows stay together.
 * A password, if given, is used only for this call and never stored or logged.
 */
export async function pdfToText(buf: Buffer, password?: string): Promise<{ text: string; pages: number }> {
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new StatementParseError("This file isn't a valid PDF.", "unreadable");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buf), password, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, stopAtErrors: false,
    }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    const code = (e as { code?: number }).code;
    if (name === "PasswordException") {
      throw code === 2
        ? new StatementParseError("That PDF password is incorrect.", "bad_password")
        : new StatementParseError("This PDF is password-protected. Enter its password to read it.", "password_required");
    }
    throw new StatementParseError("This PDF couldn't be read. It may be damaged.", "unreadable");
  }
  try {
    const out: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines = new Map<number, { x: number; s: string }[]>();
      for (const it of content.items as { str?: string; transform?: number[] }[]) {
        if (!it.str?.trim() || !it.transform) continue;
        const y = Math.round(it.transform[5]! / 2) * 2; // tolerate tiny baseline differences
        const arr = lines.get(y) ?? [];
        arr.push({ x: it.transform[4]!, s: it.str });
        lines.set(y, arr);
      }
      [...lines.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => out.push(items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(" ")));
      page.cleanup();
    }
    const text = out.join("\n");
    if (text.replace(/\s/g, "").length < 40) {
      throw new StatementParseError("This looks like a scanned PDF (no readable text). Scanned statements need OCR, which isn't enabled on this server yet — download a text PDF or CSV from your bank instead.", "scanned");
    }
    return { text, pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
