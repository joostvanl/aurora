import { describe, expect, it } from "vitest";
import {
  messageConfirmsSchemaChange,
  messageRejectsSchemaChange,
  userConfirmedSchemaChange,
} from "./frontendBrief.js";

describe("messageConfirmsSchemaChange", () => {
  it("accepts short NL/EN approvals", () => {
    expect(messageConfirmsSchemaChange("ja")).toBe(true);
    expect(messageConfirmsSchemaChange("ok")).toBe(true);
    expect(messageConfirmsSchemaChange("akkoord")).toBe(true);
    expect(messageConfirmsSchemaChange("yes go ahead")).toBe(true);
  });

  it("accepts natural approvals with commas / extra words (CMS-41)", () => {
    for (const msg of [
      "ja, doe maar",
      "ja graag",
      "ja hoor",
      "ja, ga je gang",
      "ga je gang",
      "prima doe dat",
      "top",
      "is goed",
      "helemaal goed",
      "go for it",
      "yes please do it",
      "doe maar",
      "voer het door",
    ]) {
      expect(messageConfirmsSchemaChange(msg)).toBe(true);
    }
  });

  it("rejects unrelated messages", () => {
    expect(messageConfirmsSchemaChange("voeg een titel toe")).toBe(false);
    expect(messageConfirmsSchemaChange("wat is een content type?")).toBe(false);
  });

  it("rejects ambivalent / questioning replies", () => {
    expect(messageConfirmsSchemaChange("ja maar niet het body veld")).toBe(
      false,
    );
    expect(messageConfirmsSchemaChange("ja, waarom?")).toBe(false);
    expect(messageConfirmsSchemaChange("doe maar niet")).toBe(false);
  });
});

describe("userConfirmedSchemaChange sticky history", () => {
  it("uses current message approval", () => {
    expect(userConfirmedSchemaChange("ja")).toBe(true);
  });

  it("reuses a recent approval from history", () => {
    expect(
      userConfirmedSchemaChange("voeg nu ook body toe", [
        { role: "assistant", content: "Mag ik field title aanmaken?" },
        { role: "user", content: "ja" },
        { role: "assistant", content: "Title aangemaakt. Nu body?" },
      ]),
    ).toBe(true);
  });

  it("reuses a natural-language approval from history (CMS-41)", () => {
    expect(
      userConfirmedSchemaChange("en nu een prijs-veld", [
        { role: "assistant", content: "Zal ik content type product aanmaken?" },
        { role: "user", content: "ja, doe maar" },
        { role: "assistant", content: "Product aangemaakt. Nog velden?" },
      ]),
    ).toBe(true);
  });

  it("stays blocked without any approval", () => {
    expect(
      userConfirmedSchemaChange("maak een veld title", [
        { role: "assistant", content: "Ik kan een field title toevoegen." },
        { role: "user", content: "vertel meer" },
      ]),
    ).toBe(false);
  });

  it("clears sticky approval after an explicit refusal", () => {
    expect(
      userConfirmedSchemaChange("toch maar doen", [
        { role: "user", content: "ja" },
        { role: "assistant", content: "Oké, verder?" },
        { role: "user", content: "nee" },
      ]),
    ).toBe(false);
  });

  it("current refusal overrides prior approval", () => {
    expect(
      userConfirmedSchemaChange("nee", [
        { role: "user", content: "ja" },
      ]),
    ).toBe(false);
    expect(messageRejectsSchemaChange("stop")).toBe(true);
  });
});
