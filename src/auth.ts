import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import Line from "next-auth/providers/line"
import Resend from "next-auth/providers/resend"
import Twitter from "next-auth/providers/twitter"
import { PrismaAdapter } from "@auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { z } from "zod"
import authConfig from "@/auth.config"
import { MAGIC_LINK_PROVIDER_ID } from "@/lib/auth/provider-ids"
import { sendMagicLinkEmail } from "@/lib/auth/server/email"
import { getLineLoginChannelId, getLineLoginChannelSecret } from "@/lib/line/env"
import { prisma } from "@/lib/prisma"
import { getTokenVersion } from "@/lib/auth/server/token-version-cache"

class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid_credentials"
}

class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified"
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) throw new InvalidCredentialsError()

        const { email, password } = parsed.data
        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || !user.passwordHash) throw new InvalidCredentialsError()

        const ok = await bcrypt.compare(password, user.passwordHash)
        if (!ok) throw new InvalidCredentialsError()

        if (!user.emailVerified) throw new EmailNotVerifiedError()

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
          tokenVersion: user.tokenVersion,
        }
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Twitter({
      clientId: process.env.AUTH_TWITTER_ID!,
      clientSecret: process.env.AUTH_TWITTER_SECRET!,
    }),
    Line({
      clientId: getLineLoginChannelId(),
      clientSecret: getLineLoginChannelSecret(),
      authorization: { params: { scope: "profile openid" } },
    }),
    Resend({
      id: MAGIC_LINK_PROVIDER_ID,
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url }) {
        await sendMagicLinkEmail({ to: identifier, url })
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.sub = user.id
        token.tv = user.tokenVersion ?? 0
      }
      if (trigger === "update" && token.sub) {
        token.tv = await getTokenVersion(token.sub)
      }
      return token
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub
        const currentTv = await getTokenVersion(token.sub)
        const tokenTv = typeof token.tv === "number" ? token.tv : 0
        if (currentTv !== tokenTv) return null as unknown as typeof session
      }
      return session
    },
  },
})
