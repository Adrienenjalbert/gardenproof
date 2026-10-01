/**
 * Minimal vCard reader for contact cards shared on WhatsApp (text/vcard, text/x-vcard; vCard 2.1/3.0/4.0).
 * Only what the homeowner step needs: a name and phone numbers. Pure, no dependencies.
 */
export type VCardContact = { firstName: string | null; lastName: string | null; fullName: string | null; phones: string[] };

function unescape(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

/** Unfold continuation lines (RFC 6350 §3.2) and split into "NAME;PARAMS:VALUE" lines. */
function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
}

export function parseVCards(text: string): VCardContact[] {
  const out: VCardContact[] = [];
  let cur: VCardContact | null = null;
  for (const line of lines(text)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    // "item1.TEL;type=CELL;waid=447…" -> property "TEL", params "type=CELL;waid=447…"
    const [propWithGroup, ...params] = head.split(";");
    const prop = propWithGroup.replace(/^[^.]*\./, "").toUpperCase();
    if (prop === "BEGIN" && value.toUpperCase() === "VCARD") cur = { firstName: null, lastName: null, fullName: null, phones: [] };
    else if (!cur) continue;
    else if (prop === "END") {
      out.push(cur);
      cur = null;
    } else if (prop === "FN") cur.fullName = unescape(value) || null;
    else if (prop === "N") {
      const [last, first] = value.split(";").map(unescape);
      cur.lastName = last || cur.lastName;
      cur.firstName = first || cur.firstName;
    } else if (prop === "TEL") {
      // WhatsApp adds waid=<digits> with the canonical number; prefer it over the display value.
      const waid = params.map((p) => p.match(/^waid=(\d{6,15})$/i)?.[1]).find(Boolean);
      const phone = waid ? `+${waid}` : unescape(value.replace(/^tel:/i, ""));
      if (phone && !cur.phones.includes(phone)) cur.phones.push(phone);
    }
  }
  return out.map((c) => {
    if (!c.firstName && c.fullName) {
      const [first, ...rest] = c.fullName.split(/\s+/);
      return { ...c, firstName: first || null, lastName: c.lastName ?? (rest.join(" ") || null) };
    }
    return c;
  });
}
