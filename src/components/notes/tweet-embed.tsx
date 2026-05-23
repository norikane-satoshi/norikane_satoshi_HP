"use client"

import { Tweet } from "react-tweet"

export function TweetEmbed({ id }: { id: string }) {
  return <Tweet id={id} />
}
