import { z } from "zod/v4"

export const StaffRole = z.enum(["COLORIST", "OFFLINE_EDITOR", "ONLINE_EDITOR"])
export const ClientType = z.enum(["INTERNAL", "EXTERNAL"])
export const BookingStatus = z.enum(["TENTATIVE", "CONFIRMED", "CANCELLED", "HOLIDAY", "MEETING"])
export const ProjectStatus = z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"])

export const createProjectSchema = z.object({
  title: z.string().min(1, "プロジェクト名は必須です"),
  client: z.string().min(1, "得意先名は必須です"),
  clientAlias: z.string().optional(),
  manager: z.string().optional(),
  orderNumber: z.string().optional(),
  director: z.string().optional(),
  producer: z.string().optional(),
  cameraman: z.string().optional(),
  adAgency: z.string().optional(),
  memo: z.string().optional(),
  isSelectable: z.boolean().optional(),
  projectStatus: ProjectStatus.optional(),
  dropboxPath: z.string().optional(),
  clientType: ClientType.optional(),
  actualPayment: z.number().min(0).optional().nullable(),
  createdBy: z.string().optional(),
})

export const updateProjectSchema = createProjectSchema.partial().extend({
  updatedBy: z.string().optional(),
})

export const createStaffSchema = z.object({
  name: z.string().min(1, "スタッフ名は必須です"),
  email: z.string().email("有効なメールアドレスを入力してください").optional().or(z.literal("")),
  role: StaffRole.optional(),
  specialties: z.string().optional(),
  maxConcurrent: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
})

export const updateStaffSchema = createStaffSchema.partial()

export const createResourceSchema = z.object({
  name: z.string().min(1, "リソース名は必須です"),
  machineName: z.string().optional(),
  licenseCode: z.string().optional(),
  resourceGroup: z.string().optional(),
  equipment: z.string().optional(),
  isActive: z.boolean().optional(),
})

export const updateResourceSchema = createResourceSchema.partial()

export const createBookingSchema = z
  .object({
    projectId: z.string().min(1, "プロジェクトは必須です"),
    staffId: z.string().min(1, "スタッフは必須です"),
    resourceId: z.string().min(1, "リソースは必須です"),
    startTime: z.string().or(z.date()),
    endTime: z.string().or(z.date()),
    title: z.string().optional(),
    status: BookingStatus.optional(),
    hasAttendance: z.boolean().optional(),
    isOther: z.boolean().optional(),
    memo: z.string().optional(),
    createdBy: z.string().optional(),
  })
  .refine((data) => new Date(data.startTime) < new Date(data.endTime), {
    message: "終了日時は開始日時より後でなければなりません",
    path: ["endTime"],
  })

export const updateBookingSchema = z.object({
  projectId: z.string().optional(),
  staffId: z.string().optional(),
  resourceId: z.string().optional(),
  startTime: z.string().or(z.date()).optional(),
  endTime: z.string().or(z.date()).optional(),
  title: z.string().optional(),
  status: BookingStatus.optional(),
  hasAttendance: z.boolean().optional(),
  isOther: z.boolean().optional(),
  memo: z.string().optional(),
  actualStartTime: z.string().or(z.date()).nullable().optional(),
  actualEndTime: z.string().or(z.date()).nullable().optional(),
  updatedBy: z.string().optional(),
})

export const updateRateMatrixSchema = z.object({
  hourlyRate: z.number().min(0, "時間単価は0以上で入力してください"),
})

export const upsertProjectRateOverrideSchema = z.object({
  staffRole: StaffRole,
  hourlyRate: z.number().min(0, "時間単価は0以上で入力してください"),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
