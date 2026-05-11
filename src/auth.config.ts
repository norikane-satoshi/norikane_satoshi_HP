import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import Line from "next-auth/providers/line"
import Twitter from "next-auth/providers/twitter"

export default {
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Twitter({
      clientId: process.env.AUTH_TWITTER_ID!,
      clientSecret: process.env.AUTH_TWITTER_SECRET!,
    }),
    Line({
      clientId: process.env.AUTH_LINE_ID!,
      clientSecret: process.env.AUTH_LINE_SECRET!,
      authorization: { params: { scope: "profile openid" } },
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user
    },
  },
} satisfies NextAuthConfig
