import {describe, expect, it} from "vitest"
import type {PageObjectResponse} from "@notionhq/client"
import {extractNoteLocale} from "./fetch-note"

function pageWithLanguage(name?: string): Pick<PageObjectResponse, "properties"> {
  return {
    properties: name === undefined
      ? {}
      : {
          "言語": {
            id: "language",
            type: "select",
            select: {id: name, name, color: name === "en" ? "blue" : "red"},
          },
        },
  }
}

describe("Notion note locale", () => {
  it("treats legacy rows without a language as Japanese", () => {
    expect(extractNoteLocale(pageWithLanguage())).toBe("ja")
  })

  it("selects the explicit English note", () => {
    expect(extractNoteLocale(pageWithLanguage("en"))).toBe("en")
  })

  it("keeps explicit Japanese rows in the Japanese feed", () => {
    expect(extractNoteLocale(pageWithLanguage("ja"))).toBe("ja")
  })
})
