// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { RevisitNote } from "@/components/chatbot/widget/RevisitNote"

describe("RevisitNote", () => {
  afterEach(() => cleanup())

  it("renders the customer name when provided", () => {
    render(<RevisitNote customerName="田中さん" />)

    expect(screen.getByText("田中さんで次回も続きから確認できます。")).toBeInTheDocument()
  })

  it("renders the shared account guidance", () => {
    render(<RevisitNote />)

    expect(screen.getByText("次回も同じアカウントでカレンダーが見えますよ。")).toBeInTheDocument()
  })
})
