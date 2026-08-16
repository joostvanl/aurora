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

  it("rejects unrelated messages", () => {
    expect(messageConfirmsSchemaChange("voeg een titel toe")).toBe(false);
    expect(messageConfirmsSchemaChange("wat is een content type?")).toBe(false);
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
