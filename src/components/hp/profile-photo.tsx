"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { X } from "lucide-react"

export function ProfilePhoto() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", handleKey)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener("keydown", handleKey)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative block shrink-0 overflow-hidden rounded-2xl transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-4"
        style={{
          width: 220,
          height: 220,
          boxShadow: "0 12px 40px rgba(28, 15, 110, 0.22)",
        }}
        aria-label="プロフィール写真を拡大表示"
      >
        <Image
          src="/profile-hero.png"
          alt="則兼 智志"
          fill
          sizes="220px"
          className="object-cover"
          style={{ objectPosition: "center 30%" }}
        />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10"
          style={{
            background: "rgba(8, 4, 24, 0.82)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
          role="dialog"
          aria-modal="true"
          aria-label="プロフィール写真"
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
            className="absolute right-4 top-4 rounded-full border border-white/30 p-2 text-white transition-colors hover:bg-white/10 md:right-6 md:top-6"
            aria-label="閉じる"
          >
            <X className="h-6 w-6" />
          </button>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full"
            style={{
              maxWidth: "min(90vw, 90vh)",
              aspectRatio: "1 / 1",
            }}
          >
            <Image
              src="/profile-hero.png"
              alt="則兼 智志"
              fill
              sizes="90vmin"
              className="rounded-2xl object-cover"
              priority
            />
          </div>
        </div>
      )}
    </>
  )
}
