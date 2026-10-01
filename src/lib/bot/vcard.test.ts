import { describe, expect, it } from "vitest";
import { parseVCards } from "./vcard";

describe("parseVCards", () => {
  it("reads a WhatsApp-shared contact (grouped TEL with waid)", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Hart;Emily;;;",
      "FN:Emily Hart",
      "item1.TEL;waid=447700900104:+44 7700 900104",
      "item1.X-ABLabel:Mobile",
      "END:VCARD",
    ].join("\r\n");
    expect(parseVCards(text)).toEqual([{ firstName: "Emily", lastName: "Hart", fullName: "Emily Hart", phones: ["+447700900104"] }]);
  });

  it("falls back to FN for the name, keeps every number, unfolds lines and handles several cards", () => {
    const text = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      "FN:Harri",
      " et Cole", // RFC folding: CRLF + one space is removed
      "TEL;CELL:07700 900101",
      "TEL;HOME:020 7946 0000",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:James Patel",
      "TEL;VALUE=uri;TYPE=cell:tel:+44-7700-900102",
      "END:VCARD",
    ].join("\n");
    const cards = parseVCards(text);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ firstName: "Harriet", lastName: "Cole", phones: ["07700 900101", "020 7946 0000"] });
    expect(cards[1]).toMatchObject({ firstName: "James", lastName: "Patel", phones: ["+44-7700-900102"] });
  });

  it("returns nothing for junk", () => {
    expect(parseVCards("hello")).toEqual([]);
    expect(parseVCards("")).toEqual([]);
  });
});
