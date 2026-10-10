import { assertBookingExternalWritesEnabled } from "@/lib/booking/server/external-write-policy"

import { google } from "googleapis"

import { calendarBookingSummary } from "@/lib/booking/domain/calendar-summary"
import { prisma } from "@/lib/prisma"

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
]

export const CALENDAR_TOKEN_USER_ID = "satoshi-calendar-owner"
export const HP_BOOKING_CANCEL_REQUESTED_KEY = "hp_booking_cancel_requested"
export const HP_BOOKING_CANCEL_ACK_KEY = "hp_booking_cancel_acknowledged"

type CalendarOAuthEnv = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type CalendarBusySlot = {
  start: string
  end: string
}

export type CalendarBusyEventWithBuffer = CalendarBusySlot & {
  bufferHours: number | null
  bufferBeforeHours: number | null
  bufferAfterHours: number | null
  summary: string | null
  source?: "google_calendar" | "notion_work"
}

export type CalendarTentativeHoldEvent = CalendarBusySlot

export type CalendarEventWriteInput = {
  calendarId: string
  summary: string
  description: string
  start: string
  end: string
  colorId: string
  accessToken: string
  eventId?: string
  bookingGroupId?: string
  customerName?: string
  customerCompany?: string
  notionTaskType?: "仮押さえ" | "本予約"
  dateOnly?: boolean
  transparency?: "opaque" | "transparent"
}

export type CalendarEventUpdateInput = {
  calendarId: string
  eventId: string
  accessToken: string
  start: string
  end: string
  dateOnly?: boolean
  summary?: string
  description?: string
  colorId?: string
  notionTaskType?: "仮押さえ" | "本予約"
  bookingGroupId?: string
  customerName?: string
  customerCompany?: string
  transparency?: "opaque" | "transparent"
  bufferBeforeHours?: number | null
  bufferAfterHours?: number | null
}

export type ManagedCalendarEventSnapshot = {
  id: string
  start: string
  end: string
  dateOnly: boolean
  summary: string
  description: string
  colorId: string
  notionTaskType?: string
  transparency?: string
  bookingGroupId?: string
  privateProperties: Record<string, string>
}

export type CalendarEventSnapshot = {
  id: string
  privateProperties: Record<string, string>
  start?: string
  end?: string
  dateOnly?: boolean
  summary?: string
  description?: string
  colorId?: string
  notionTaskType?: string
  transparency?: string
  bookingGroupId?: string
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

export function getCalendarAuthUrl(state: string): string {
  const oauth2Client = createCalendarOAuthClient()
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
    state,
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

// 終日イベントは start.date / end.date しか持たない。日付文字列のまま返すと
// 下流の new Date() が UTC 0:00 として解釈し、JST では 9 時間ずれた区間になる。
// カレンダーの運用タイムゾーンである JST の 0:00 に正規化して返す。
function toJstMidnightIso(date: string | null | undefined): string | undefined {
  if (!date) return undefined
  const parsed = new Date(`${date}T00:00:00.000+09:00`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

const JST_MIDNIGHT_DATETIME = /T00:00(:00(\.\d+)?)?\+09:00$/

// 終日は日付フィールドだけとは限らない。IB_仕事 の【仮キープ】は JST 0:00 → 0:00 の
// dateTime としてミラーされることがあり、これも時刻の幅を持たない終日枠である。
function isAllDayEvent(event: {
  start?: { date?: string | null; dateTime?: string | null } | null
  end?: { date?: string | null; dateTime?: string | null } | null
}): boolean {
  const start = event.start?.dateTime
  const end = event.end?.dateTime
  if (!start) return Boolean(event.start?.date)
  if (!end) return false
  if (!JST_MIDNIGHT_DATETIME.test(start) || !JST_MIDNIGHT_DATETIME.test(end)) return false
  return new Date(end).getTime() > new Date(start).getTime()
}

function isNotionMirroredAllDayEvent(event: {
  start?: { date?: string | null; dateTime?: string | null } | null
  end?: { date?: string | null; dateTime?: string | null } | null
  extendedProperties?: { private?: Record<string, string> | null } | null
}): boolean {
  return isAllDayEvent(event) && Boolean(event.extendedProperties?.private?.notion_page_id)
}

export async function listBusyEventsWithBuffer(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  accessToken: string,
): Promise<CalendarBusyEventWithBuffer[]> {
  const oauth2Client = createCalendarOAuthClient()
  oauth2Client.setCredentials({ access_token: accessToken })

  const calendar = google.calendar({ version: "v3", auth: oauth2Client })
  const slots: CalendarBusyEventWithBuffer[] = []
  let pageToken: string | undefined

  do {
    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      pageToken,
    })

    for (const event of response.data.items ?? []) {
      if (event.transparency === "transparent") continue
      // IB_仕事 のミラーである終日イベントは、GCal 側からは仮押さえ（選択可）と
      // 本予約（NG）を区別できない。タスク種別を持つ Notion 経路を唯一の権威にする。
      if (isNotionMirroredAllDayEvent(event)) continue
      const start = event.start?.dateTime ?? toJstMidnightIso(event.start?.date)
      const end = event.end?.dateTime ?? toJstMidnightIso(event.end?.date)
      if (!start || !end) continue

      const parsedBuffer = Number(event.extendedProperties?.private?.bufferHours)
      const parsedBefore = Number(event.extendedProperties?.private?.bufferBeforeHours)
      const parsedAfter = Number(event.extendedProperties?.private?.bufferAfterHours)
      slots.push({
        start,
        end,
        bufferHours: Number.isFinite(parsedBuffer) ? parsedBuffer : null,
        bufferBeforeHours: Number.isFinite(parsedBefore) && parsedBefore >= 0 ? parsedBefore : null,
        bufferAfterHours: Number.isFinite(parsedAfter) && parsedAfter >= 0 ? parsedAfter : null,
        summary: event.summary ?? null,
        source: "google_calendar",
      })
    }

    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return slots
}

export async function listTentativeHoldEvents(
  calendarId: string,
  timeMin: string,
  timeMax: string,
  accessToken: string,
): Promise<CalendarTentativeHoldEvent[]> {
  const oauth2Client = createCalendarOAuthClient()
  oauth2Client.setCredentials({ access_token: accessToken })

  const calendar = google.calendar({ version: "v3", auth: oauth2Client })
  const slots: CalendarTentativeHoldEvent[] = []
  let pageToken: string | undefined

  do {
    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: false,
      privateExtendedProperty: ["source=hp-booking", "notion_task_type=仮押さえ"],
      pageToken,
    })

    for (const event of response.data.items ?? []) {
      const privateProperties = event.extendedProperties?.private
      if (privateProperties?.source !== "hp-booking") continue
      if (privateProperties.notion_task_type !== "仮押さえ") continue

      const start = event.start?.dateTime ?? event.start?.date
      const end = event.end?.dateTime ?? event.end?.date
      if (!start || !end) continue
      slots.push({ start, end })
    }

    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return slots
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
  assertBookingExternalWritesEnabled()
  const calendar = createCalendarWriteClient(input.accessToken)
  const start = input.dateOnly ? { date: input.start } : { dateTime: input.start }
  const end = input.dateOnly ? { date: input.end } : { dateTime: input.end }
  try {
    const response = await calendar.events.insert({
      calendarId: input.calendarId,
      requestBody: {
        id: input.eventId,
        summary: calendarBookingSummary(input.summary, input.notionTaskType),
        description: input.description,
        colorId: input.colorId,
        start,
        end,
        ...(input.transparency ? { transparency: input.transparency } : {}),
        extendedProperties: {
          private: {
            source: "hp-booking",
            ...(input.bookingGroupId ? { booking_group_id: input.bookingGroupId } : {}),
            ...(input.notionTaskType ? { notion_task_type: input.notionTaskType } : {}),
            ...(input.customerName !== undefined ? { customer_name: input.customerName } : {}),
            ...(input.customerCompany !== undefined ? { customer_company: input.customerCompany } : {}),
          },
        },
      },
    })

    if (!response.data.id) {
      throw new Error("Google Calendar event insert did not return event id")
    }

    return { id: response.data.id }
  } catch (error) {
    if (input.eventId && getGoogleErrorStatus(error) === 409) {
      const existing = await calendar.events.get({
        calendarId: input.calendarId,
        eventId: input.eventId,
      })
      if (!existing.data.id) {
        throw new Error("Google Calendar event get did not return event id")
      }
      const owner = existing.data.extendedProperties?.private?.booking_group_id
      if (input.bookingGroupId && owner && owner !== input.bookingGroupId) {
        throw Object.assign(new Error("Google Calendar event belongs to another booking group"), {
          code: "calendar_event_ownership_mismatch",
        })
      }
      return { id: existing.data.id }
    }
    throw error
  }
}

export async function getCalendarEvent(input: {
  calendarId: string
  eventId: string
  accessToken: string
}): Promise<CalendarEventSnapshot | null> {
  const calendar = createCalendarWriteClient(input.accessToken)
  try {
    const response = await calendar.events.get({
      calendarId: input.calendarId,
      eventId: input.eventId,
    })
    if (!response.data.id) return null
    const snapshot = managedEventSnapshot(response.data)
    return snapshot ?? {
      id: response.data.id,
      privateProperties: response.data.extendedProperties?.private ?? {},
    }
  } catch (error) {
    const status = getGoogleErrorStatus(error)
    if (status === 404 || status === 410) return null
    throw error
  }
}

export async function requestCalendarEventCancellation(input: {
  calendarId: string
  eventId: string
  bookingGroupId: string
  accessToken: string
}): Promise<void> {
  assertBookingExternalWritesEnabled()
  const calendar = createCalendarWriteClient(input.accessToken)
  await calendar.events.patch({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: {
      transparency: "transparent",
      extendedProperties: {
        private: {
          source: "hp-booking",
          booking_group_id: input.bookingGroupId,
          [HP_BOOKING_CANCEL_REQUESTED_KEY]: "1",
        },
      },
    },
  })
}

function managedEventSnapshot(event: {
  id?: string | null
  start?: { date?: string | null; dateTime?: string | null } | null
  end?: { date?: string | null; dateTime?: string | null } | null
  summary?: string | null
  description?: string | null
  colorId?: string | null
  transparency?: string | null
  extendedProperties?: { private?: Record<string, string> | null } | null
}): ManagedCalendarEventSnapshot | null {
  const id = event.id ?? ""
  const start = event.start?.date ?? event.start?.dateTime ?? ""
  const end = event.end?.date ?? event.end?.dateTime ?? ""
  if (!id || !start || !end) return null
  return {
    id,
    start,
    end,
    dateOnly: Boolean(event.start?.date),
    summary: event.summary ?? "",
    description: event.description ?? "",
    colorId: event.colorId ?? "9",
    notionTaskType: event.extendedProperties?.private?.notion_task_type
      ?? event.extendedProperties?.private?.notionTaskType,
    transparency: event.transparency ?? undefined,
    bookingGroupId: event.extendedProperties?.private?.booking_group_id,
    privateProperties: event.extendedProperties?.private ?? {},
  }
}

export async function listManagedCalendarEvents(input: {
  calendarId: string
  accessToken: string
}): Promise<ManagedCalendarEventSnapshot[]> {
  const calendar = createCalendarWriteClient(input.accessToken)
  const events: ManagedCalendarEventSnapshot[] = []
  let pageToken: string | undefined

  do {
    const response = await calendar.events.list({
      calendarId: input.calendarId,
      privateExtendedProperty: ["source=hp-booking"],
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      pageToken,
    })
    for (const event of response.data.items ?? []) {
      const snapshot = managedEventSnapshot(event)
      if (snapshot) events.push(snapshot)
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return events
}

export async function updateCalendarEvent(input: CalendarEventUpdateInput): Promise<void> {
  assertBookingExternalWritesEnabled()
  const calendar = createCalendarWriteClient(input.accessToken)
  const privateProperties: Record<string, string> = {}
  if (input.bookingGroupId) {
    privateProperties.source = "hp-booking"
    privateProperties.booking_group_id = input.bookingGroupId
  }
  if (input.notionTaskType) {
    privateProperties.notion_task_type = input.notionTaskType
  }
  if (input.customerName !== undefined) privateProperties.customer_name = input.customerName
  if (input.customerCompany !== undefined) privateProperties.customer_company = input.customerCompany
  if (Number.isFinite(input.bufferBeforeHours)) {
    privateProperties.bufferBeforeHours = String(input.bufferBeforeHours)
  }
  if (Number.isFinite(input.bufferAfterHours)) {
    privateProperties.bufferAfterHours = String(input.bufferAfterHours)
  }
  await calendar.events.patch({
    calendarId: input.calendarId,
    eventId: input.eventId,
    requestBody: {
      ...(input.summary !== undefined ? { summary: calendarBookingSummary(input.summary, input.notionTaskType) } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.colorId !== undefined ? { colorId: input.colorId } : {}),
      ...(input.transparency !== undefined ? { transparency: input.transparency } : {}),
      start: input.dateOnly ? { date: input.start } : { dateTime: input.start },
      end: input.dateOnly ? { date: input.end } : { dateTime: input.end },
      ...(Object.keys(privateProperties).length > 0
        ? {
            extendedProperties: {
              private: privateProperties,
            },
          }
        : {}),
    },
  })
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  assertBookingExternalWritesEnabled()
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

  await deleteCalendarEventWithAccessToken({
    calendarId,
    eventId,
    accessToken: refreshed.accessToken,
  })
}

export async function deleteCalendarEventWithAccessToken(input: {
  calendarId: string
  eventId: string
  accessToken: string
}): Promise<void> {
  assertBookingExternalWritesEnabled()
  const calendar = createCalendarWriteClient(input.accessToken)
  try {
    await calendar.events.delete({
      calendarId: input.calendarId,
      eventId: input.eventId,
    })
  } catch (error) {
    const status = getGoogleErrorStatus(error)
    if (status === 404 || status === 410) {
      console.warn(`[gcal delete skipped] eventId=${input.eventId} status=${status}`)
      return
    }
    throw error
  }
}
