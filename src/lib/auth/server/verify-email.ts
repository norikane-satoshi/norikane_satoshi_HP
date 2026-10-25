import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export function verifyEmail(where: Prisma.UserWhereInput, emailVerified = new Date()) {
  return prisma.user.updateMany({
    where: { ...where, emailVerified: null },
    data: { emailVerified, passwordHash: null },
  })
}
