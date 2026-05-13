import type { BlockObjectResponse } from "@notionhq/client"

export type BlockWithChildren = BlockObjectResponse & {
  children?: BlockWithChildren[]
}
