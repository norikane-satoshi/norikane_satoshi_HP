/**
 * How the audit records a Slack post that a check conversation deliberately left out. Kept free of
 * imports so the live verification scripts can read it alongside the server.
 */
export const chatbotDiagnosticSlackSkipErrorCode = "slack-skipped-diagnostic"
