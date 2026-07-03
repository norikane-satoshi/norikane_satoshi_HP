import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  query: vi.fn(),
  insert: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  getAccessToken: vi.fn(),
  getToken: vi.fn(),
  generateAuthUrl: vi.fn(),
  setCredentials: vi.fn(),
}))

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() {
        return {
          credentials: {
            expiry_date: new Date("2026-06-10T00:00:00.000Z").getTime(),
            scope: "scope",
          },
          generateAuthUrl: mocks.generateAuthUrl,
          getAccessToken: mocks.getAccessToken,
          getToken: mocks.getToken,
          setCredentials: mocks.setCredentials,
        }
      }),
    },
    calendar: vi.fn(() => ({
      freebusy: { query: mocks.query },
      events: {
        delete: mocks.delete,
        insert: mocks.insert,
        list: mocks.list,
        patch: mocks.patch,
      },
    })),
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    calendarToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import {
  CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError,
  exchangeCalendarCode,
  getCalendarAuthUrl,
  getFreeBusy,
  listBusyEventsWithBuffer,
  refreshCalendarAccessToken,
} from "@/lib/google-calendar/server"

function setOAuthEnv() {
  process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID = "client_id"
  process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET = "client_secret"
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost/callback"
}

describe("google-calendar helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOAuthEnv()
  })

  it("builds the Google Calendar consent URL", () => {
    mocks.generateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth")

    expect(getCalendarAuthUrl("state_token_value")).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
      access_type: "offline",
      prompt: "consent",
      state: "state_token_value",
      scope: expect.arrayContaining([
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events",
      ]),
    }))
  })

  it("lists opaque events with parsed buffer hours and skips transparent or incomplete events", async () => {
    mocks.list
      .mockResolvedValueOnce({
        data: {
          nextPageToken: "page_2",
          items: [
            {
              transparency: "transparent",
              start: { dateTime: "2026-06-10T00:00:00.000Z" },
              end: { dateTime: "2026-06-10T01:00:00.000Z" },
              extendedProperties: { private: { bufferHours: "2" } },
            },
            {
              start: { dateTime: "2026-06-10T01:00:00.000Z" },
              end: { dateTime: "2026-06-10T02:00:00.000Z" },
              extendedProperties: { private: { bufferHours: "bad" } },
            },
            {
              start: {},
              end: { dateTime: "2026-06-10T03:00:00.000Z" },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              start: { date: "2026-06-11" },
              end: { date: "2026-06-12" },
            },
          ],
        },
      })

    await expect(
      listBusyEventsWithBuffer(
        "calendar_1",
        "2026-06-01T00:00:00.000Z",
        "2026-06-30T00:00:00.000Z",
        "access_token",
      ),
    ).resolves.toEqual([
      {
        start: "2026-06-10T01:00:00.000Z",
        end: "2026-06-10T02:00:00.000Z",
        source: "google_calendar",
        bufferHours: null,
        bufferBeforeHours: null,
        bufferAfterHours: null,
        summary: null,
      },
      {
        start: "2026-06-11",
        end: "2026-06-12",
        source: "google_calendar",
        bufferHours: null,
        bufferBeforeHours: null,
        bufferAfterHours: null,
        summary: null,
      },
    ])
    expect(mocks.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: "page_2" }))
  })

  it("propagates Google events.list failures", async () => {
    mocks.list.mockRejectedValue(new Error("events failed"))

    await expect(
      listBusyEventsWithBuffer(
        "calendar_1",
        "2026-06-01T00:00:00.000Z",
        "2026-06-30T00:00:00.000Z",
        "access_token",
      ),
    ).rejects.toThrow("events failed")
  })

  it("returns freebusy slots with complete start/end only", async () => {
    mocks.query.mockResolvedValue({
      data: {
        calendars: {
          calendar_1: {
            busy: [
              { start: "2026-06-10T01:00:00.000Z", end: "2026-06-10T02:00:00.000Z" },
              { start: "2026-06-10T03:00:00.000Z" },
            ],
          },
        },
      },
    })

    await expect(
      getFreeBusy(
        "calendar_1",
        "2026-06-01T00:00:00.000Z",
        "2026-06-30T00:00:00.000Z",
        "access_token",
      ),
    ).resolves.toEqual([
      { start: "2026-06-10T01:00:00.000Z", end: "2026-06-10T02:00:00.000Z" },
    ])
  })

  it("maps missing oauth env and invalid_grant refresh errors", async () => {
    delete process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET

    await expect(
      listBusyEventsWithBuffer(
        "calendar_1",
        "2026-06-01T00:00:00.000Z",
        "2026-06-30T00:00:00.000Z",
        "access_token",
      ),
    ).rejects.toBeInstanceOf(CalendarOAuthEnvMissingError)

    setOAuthEnv()
    mocks.getAccessToken.mockRejectedValue({ response: { data: { error: "invalid_grant" } } })

    await expect(refreshCalendarAccessToken("refresh_token")).rejects.toBeInstanceOf(CalendarTokenRevokedError)
  })

  it("requires access and refresh tokens during code exchange", async () => {
    mocks.getToken.mockResolvedValueOnce({ tokens: { access_token: "access_token" } })
    await expect(exchangeCalendarCode("code_1")).rejects.toThrow("refresh_token")

    mocks.getToken.mockResolvedValueOnce({
      tokens: {
        access_token: "access_token",
        refresh_token: "refresh_token",
        expiry_date: new Date("2026-06-10T00:00:00.000Z").getTime(),
      },
    })

    await expect(exchangeCalendarCode("code_2")).resolves.toMatchObject({
      accessToken: "access_token",
      refreshToken: "refresh_token",
    })
  })
})
