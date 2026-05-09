import { google } from "googleapis"

import { prisma } from "@/lib/prisma"

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
]

export const CALENDAR_TOKEN_USER_ID = "satoshi-calendar-owner"

type CalendarOAuthEnv = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type CalendarBusySlot = {
  start: string
  end: string
}

export type CalendarEventWriteInput = {
  calendarId: string
  summary: string
  description: string
  start: string
  end: string
  colorId: string
  accessToken: string
}

export type CalendarEventUpdateInput = CalendarEventWriteInput & {
  eventId: string
}

export type RefreshedCalendarToken = {
  accessToken: string
  expiresAt: Date
  scope: string
}

export class CalendarOAuthEnvMissingError extends Error {
  code = "calendar_oauth_env_missing" as const

  constructor(missing: string[]) {
    super(`Missing Google Calendar OAuth env: ${missing.join(", ")}`)
    this.name = "CalendarOAuthEnvMissingError"
  }
}

export class CalendarTokenRevokedError extends Error {
  code = "calendar_token_revoked" as const

  constructor(message = "Google Calendar refresh token is revoked") {
    super(message)
    this.name = "CalendarTokenRevokedError"
  }
}

function requireCalendarOAuthEnv(): CalendarOAuthEnv {
  const clientId = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI

  const envEntries = [
    ["GOOGLE_CALENDAR_OAUTH_CLIENT_ID", clientId],
    ["GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET", clientSecret],
    ["GOOGLE_CALENDAR_REDIRECT_URI", redirectUri],
  ] satisfies [string, string | undefined][]
  const missing = envEntries
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new CalendarOAuthEnvMissingError(missing)
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
  }
}

export function createCalendarOAuthClient() {
  const { clientId, clientSecret, redirectUri } = requireCalendarOAuthEnv()
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function getCalendarAuthUrl(): string {
  const oauth2Client = createCalendarOAuthClient()
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
  })
}

export async function exchangeCalendarCode(code: string): Promise<RefreshedCalendarToken & { refreshToken: string }> {
  const oauth2Client = createCalendarOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)

  if (!tokens.access_token) {
    throw new Error("Google Calendar OAuth did not return access_token")
  }
  if (!tokens.refresh_token) {
    throw new Error("Google Calendar OAuth did not return refresh_token")
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date ?? Date.now()),
    scope: tokens.scope ?? CALENDAR_SCOPES.join(" "),
  }
}

export async function refreshCalendarAccessToken(refreshToken: string): Promise<RefreshedCalendarToken> {
  const oauth2Client = createCalendarOAuthClient()
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  const { token } = await oauth2Client.getAccessToken().catch((error) => {
    if (isGoogleInvalidGrantError(error)) {
      throw new CalendarTokenRevokedError()
    }
    throw error
  })
  if (!token) {
    throw new Error("Google Calendar OAuth refresh did not return access_token")
  }

  return {
    accessToken: token,
    expiresAt: new Date(oauth2Client.credentials.expiry_date ?? Date.now()),
    scope: oauth2Client.credentials.scope ?? CALENDAR_SCOPES.join(" "),
  }
}

function isGoogleInvalidGrantError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as {
    message?: unknown
    response?: { data?: { error?: unknown; error_description?: unknown } }
  }
  const values = [
    candidate.message,
    candidate.response?.data?.error,
    candidate.response?.data?.error_description,
  ]
  return values.some((value) => typeof value === "string" && value.includes("invalid_grant"))
}

export async function getFreeBusy(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  accessToken: string,
): Promise<CalendarBusySlot[]> {
  const oauth2Client = createCalendarOAuthClient()
  oauth2Client.setCredentials({ access_token: accessToken })

  const calendar = google.calendar({ version: "v3", auth: oauth2Client })
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    },
  })

  const busy = response.data.calendars?.[calendarId]?.busy ?? []
  return busy.flatMap((slot) => {
    if (!slot.start || !slot.end) return []
    return [{ start: slot.start, end: slot.end }]
  })
}

function createCalendarWriteClient(accessToken: string) {
  const oauth2Client = createCalendarOAuthClient()
  oauth2Client.setCredentials({ access_token: accessToken })
  return google.calendar({ version: "v3", auth: oauth2Client })
}

function getGoogleErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null
  const maybeError = error as {
    code?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  const status = maybeError.response?.status ?? maybeError.status ?? maybeError.code
  return typeof status === "number" ? status : null
}

export async function createCalendarEvent(input: CalendarEventWriteInput): Promise<{ id: string }> {
  const calendar = createCalendarWriteClient(input.accessToken)
  const response = await calendar.events.insert({
    calendarId: input.calendarId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      colorId: input.colorId,
      start: {
        dateTime: input.start,
      },
      end: {
        dateTime: input.end,
      },
    },
  })

  if (!response.data.id) {
    throw new Error("Google Calendar event insert did not return event id")
  }

  return { id: response.data.id }
}

export async function updateCalendarEvent(input: CalendarEventUpdateInput): Promise<{ id: string }> {
  const calendar = createCalendarWriteClient(input.accessToken)
  const response = await calendar.events.patch({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      colorId: input.colorId,
      start: {
        dateTime: input.start,
      },
      end: {
        dateTime: input.end,
      },
    },
  })

  if (!response.data.id) {
    throw new Error("Google Calendar event update did not return event id")
  }

  return { id: response.data.id }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
  if (!calendarId) {
    console.warn(`[gcal delete skipped] eventId=${eventId} reason=missing_calendar_id`)
    return
  }

  const storedToken = await prisma.calendarToken.findUnique({
    where: { userId: CALENDAR_TOKEN_USER_ID },
  })
  if (!storedToken) {
    console.warn(`[gcal delete skipped] eventId=${eventId} reason=missing_calendar_token`)
    return
  }

  const refreshed = await refreshCalendarAccessToken(storedToken.refreshToken)
  await prisma.calendarToken.update({
    where: { userId: CALENDAR_TOKEN_USER_ID },
    data: {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
    },
  })

  const calendar = createCalendarWriteClient(refreshed.accessToken)
  try {
    await calendar.events.delete({
      calendarId,
      eventId,
    })
  } catch (error) {
    const status = getGoogleErrorStatus(error)
    if (status === 404 || status === 410) {
      console.warn(`[gcal delete skipped] eventId=${eventId} status=${status}`)
      return
    }
    throw error
  }
}
