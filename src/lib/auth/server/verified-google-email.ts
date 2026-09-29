import type { NextAuthConfig } from "next-auth"
import { prisma } from "@/lib/prisma"

type SignInEvent = Parameters<NonNullable<NonNullable<NextAuthConfig["events"]>["signIn"]>>[0]

/** Called after Auth.js has created/linked the persisted user, not before account creation. */
export async function markVerifiedGoogleEmail({ user, account, profile }: SignInEvent): Promise<void> {
  if (account?.provider !== "google" || profile?.email_verified !== true) return
  if (!user.id || !user.email || typeof profile.email !== "string") return
  if (user.email.trim().toLowerCase() !== profile.email.trim().toLowerCase()) return

  // Guard against a changed address and preserve any existing verification timestamp.
  await prisma.user.updateMany({
    where: { id: user.id, email: user.email, emailVerified: null },
    data: { emailVerified: new Date() },
  })
}
