export type NotionAiDomFallbackSelectors = {
  textbox: string
  sendButton: string
}

export const notionAiDomFallbackSelectors: NotionAiDomFallbackSelectors = {
  textbox: 'div#\\:r2d\\:[role="textbox"][contenteditable="true"]',
  sendButton: "div > div:nth-of-type(2) > div > div:nth-of-type(2) > button",
}

export function buildNotionAiDomFallbackExpression(message: string): string {
  return `(() => {
    const textbox = document.querySelector(${JSON.stringify(notionAiDomFallbackSelectors.textbox)});
    if (!textbox) return { ok: false, stage: "textbox" };
    textbox.textContent = ${JSON.stringify(message)};
    textbox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(
      message,
    )} }));
    const button = document.querySelector(${JSON.stringify(notionAiDomFallbackSelectors.sendButton)});
    if (!button) return { ok: false, stage: "send-button" };
    button.click();
    return { ok: true };
  })()`
}
