import { describe, expect, it } from "vitest";

import { EMPTY_BRIEF, blanks, fromMarkdown, isBlank, parseDraft, tagline, toMarkdown, withDraft } from "./company";

describe("the company brief", () => {
  it("round-trips through COMPANY.md, keeping what the owner wrote beyond the sections", () => {
    const file = "# planilha.\n\n## Product\n\nA finance sheet.\nThat fills itself.\n\n## Voice\n\nPlain.\n\n## Pricing notes\n\nPro is R$19.";
    const brief = fromMarkdown(file);
    expect(brief).toMatchObject({ product: "A finance sheet.\nThat fills itself.", voice: "Plain.", audience: "" });
    expect(brief.rest).toBe("## Pricing notes\n\nPro is R$19.");
    expect(toMarkdown(brief, "planilha.")).toBe(file);
    expect(fromMarkdown(toMarkdown(brief, "renamed"))).toEqual(brief);
  });

  it("reads a section after the owner's own one, and headings in any case", () => {
    const brief = fromMarkdown("Some intro\n\n## notes\nx\n\n## GOALS\nShip it");
    expect(brief.goals).toBe("Ship it");
    expect(brief.rest).toBe("Some intro\n\n## notes\nx");
  });

  it("knows an empty brief and which sections are left", () => {
    expect(isBlank(fromMarkdown(""))).toBe(true);
    expect(blanks({ ...EMPTY_BRIEF, product: "x", goals: " " })).toEqual(["audience", "voice", "goals", "channels"]);
  });

  it("takes the CLI's draft from a fenced or chatty reply, and drops anything that isn't text", () => {
    const reply = 'Here it is:\n```json\n{"product": " A sheet ", "audience": 3, "voice": "", "goals": "More trials", "extra": "x"}\n```';
    expect(parseDraft(reply)).toEqual({ product: "A sheet", goals: "More trials" });
    expect(parseDraft("no json here")).toEqual({});
    expect(parseDraft("{broken")).toEqual({});
  });

  it("fills only the sections the owner left empty", () => {
    const mine = { ...EMPTY_BRIEF, product: "Mine" };
    expect(withDraft(mine, { product: "Theirs", voice: "Calm" })).toMatchObject({ product: "Mine", voice: "Calm", goals: "" });
  });
});

describe("the company's line", () => {
  it("is the product's first sentence, with links reduced to their words", () => {
    const brief = { ...EMPTY_BRIEF, product: "A marketplace for [landlords](https://x.io) to book crews. AI writes the brief." };
    expect(tagline(brief)).toBe("A marketplace for landlords to book crews.");
    expect(tagline({ ...EMPTY_BRIEF, product: "x".repeat(300) }, 20)).toHaveLength(20);
  });
});
