"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {useLocale} from "next-intl"
import {
  applyOutputTransform,
  applySourceTransform,
  clampRgb,
  type OutputTransform,
  type SourceTransform,
} from "@/lib/look-gallery/color"
import { parseCube, sampleCube, type CubeLut, type Rgb } from "@/lib/look-gallery/cube"
import {
  deleteSessionAsset,
  getTabSessionId,
  listSessionAssets,
  saveSessionAsset,
  type StoredLookAsset,
} from "@/lib/look-gallery/session-store"

const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_UPLOAD_IMAGES = 12
const DEFAULT_IMAGE_ID = "default-image"
const DEFAULT_LUT_ID = "default-lut"

interface GalleryImage {
  id: string
  name: string
  src: string
  uploaded: boolean
}

interface GalleryLut {
  id: string
  name: string
  lut: CubeLut
  uploaded: boolean
}

type LutTarget = "none" | "acescct-ap1" | "rec709-video"

interface PreviewCanvasProps {
  image: GalleryImage
  lut: CubeLut | null
  sourceTransform: SourceTransform
  outputTransform: OutputTransform
  large?: boolean
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error("画像を読み込めませんでした。"))
  image.src = src
})

function drawProtectedPreview(canvas: HTMLCanvasElement, processed: HTMLCanvasElement) {
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.filter = "blur(1.15px)"
  context.drawImage(processed, 0, 0)
  context.restore()

  const watermarkSize = Math.max(13, Math.round(canvas.width / 42))
  context.save()
  context.globalAlpha = 0.22
  context.fillStyle = "#ffffff"
  context.font = `600 ${watermarkSize}px system-ui, sans-serif`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(-Math.PI / 8)
  const stepX = watermarkSize * 10
  const stepY = watermarkSize * 5
  for (let y = -canvas.height; y <= canvas.height; y += stepY) {
    for (let x = -canvas.width; x <= canvas.width; x += stepX) {
      context.fillText("NCS PREVIEW", x, y)
    }
  }
  context.restore()
}

function PreviewCanvas({
  image,
  lut,
  sourceTransform,
  outputTransform,
  large = false,
  canvasRef,
}: PreviewCanvasProps) {
  const english = useLocale() === "en"
  const localRef = useRef<HTMLCanvasElement>(null)
  const targetRef = canvasRef ?? localRef
  const [state, setState] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let cancelled = false
    setState("loading")

    const render = async () => {
      try {
        const sourceImage = await loadImage(image.src)
        if (cancelled || !targetRef.current) return
        const maximumWidth = large ? 1280 : 720
        const scale = Math.min(1, maximumWidth / sourceImage.naturalWidth)
        const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale))
        const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale))
        const working = document.createElement("canvas")
        working.width = width
        working.height = height
        const workingContext = working.getContext("2d", { willReadFrequently: true })
        if (!workingContext) throw new Error("Canvasを初期化できませんでした。")
        workingContext.drawImage(sourceImage, 0, 0, width, height)
        const pixels = workingContext.getImageData(0, 0, width, height)

        if (sourceTransform !== "none" || lut || outputTransform !== "none") {
          for (let index = 0; index < pixels.data.length; index += 4) {
            let rgb: Rgb = [
              pixels.data[index] / 255,
              pixels.data[index + 1] / 255,
              pixels.data[index + 2] / 255,
            ]
            rgb = applySourceTransform(rgb, sourceTransform)
            if (lut) rgb = sampleCube(lut, rgb)
            rgb = clampRgb(applyOutputTransform(rgb, outputTransform))
            pixels.data[index] = Math.round(rgb[0] * 255)
            pixels.data[index + 1] = Math.round(rgb[1] * 255)
            pixels.data[index + 2] = Math.round(rgb[2] * 255)
          }
          workingContext.putImageData(pixels, 0, 0)
        }

        if (cancelled || !targetRef.current) return
        targetRef.current.width = width
        targetRef.current.height = height
        drawProtectedPreview(targetRef.current, working)
        setState("ready")
      } catch {
        if (!cancelled) setState("error")
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [image, large, lut, outputTransform, sourceTransform, targetRef])

  return (
    <div className="relative aspect-video overflow-hidden rounded-[12px] bg-[color:var(--hp-color-surface)]">
      <canvas
        ref={targetRef}
        className="h-full w-full object-cover"
        aria-label={english ? `Protected preview of ${image.name}` : `${image.name}の保護プレビュー`}
      />
      {state !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center bg-white/40 text-sm text-hp-muted">
          {state === "loading" ? (english ? "Rendering" : "現像中") : (english ? "Preview unavailable" : "プレビューを表示できません")}
        </div>
      ) : null}
    </div>
  )
}

const validateFileSize = (file: File, english: boolean) => {
  if (file.size > MAX_FILE_SIZE) throw new Error(english ? `${file.name} exceeds 50 MB.` : `${file.name} は50MBを超えています。`)
}

const imageExtensionAllowed = (file: File) => {
  const extension = file.name.toLowerCase().split(".").pop()
  return ["jpg", "jpeg", "png", "webp"].includes(extension ?? "")
}

const sourceLabels: Record<SourceTransform, string> = {
  none: "変換なし",
  "slog3-sgamut3cine": "S-Log3 / S-Gamut3.Cine to ACEScct",
  "logc3-awg3": "LogC3 / ARRI Wide Gamut 3 to ACEScct",
}

const outputLabels: Record<OutputTransform, string> = {
  none: "変換なし",
  "aces-sdr-rec709": "ACEScct to SDR Rec.709",
}

const lutTargetLabels: Record<LutTarget, string> = {
  none: "指定なし",
  "acescct-ap1": "AP1 / ACEScct",
  "rec709-video": "Rec.709 / Video gamma",
}

export function LookGallery() {
  const english = useLocale() === "en"
  const localizedSourceLabels = useMemo<Record<SourceTransform, string>>(() => ({
    ...sourceLabels,
    none: english ? "No transform" : sourceLabels.none,
  }), [english])
  const localizedOutputLabels = useMemo<Record<OutputTransform, string>>(() => ({
    ...outputLabels,
    none: english ? "No transform" : outputLabels.none,
  }), [english])
  const localizedLutTargetLabels = useMemo<Record<LutTarget, string>>(() => ({
    ...lutTargetLabels,
    none: english ? "None" : lutTargetLabels.none,
  }), [english])
  const [images, setImages] = useState<GalleryImage[]>([])
  const [luts, setLuts] = useState<GalleryLut[]>([])
  const [batchLutId, setBatchLutId] = useState(DEFAULT_LUT_ID)
  const [imageLutIds, setImageLutIds] = useState<Record<string, string>>({})
  const [sourceTransform, setSourceTransform] = useState<SourceTransform>("none")
  const [outputTransform, setOutputTransform] = useState<OutputTransform>("none")
  const [lutTarget, setLutTarget] = useState<LutTarget>("rec709-video")
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [message, setMessage] = useState(english ? "Preparing" : "準備しています")
  const modalCanvasRef = useRef<HTMLCanvasElement>(null)
  const objectUrlsRef = useRef<string[]>([])

  const createObjectUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob)
    objectUrlsRef.current.push(url)
    return url
  }, [])

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        const sessionId = getTabSessionId()
        const [defaultLutText, storedAssets] = await Promise.all([
          fetch("/look-gallery/default-look.cube").then((response) => {
            if (!response.ok) throw new Error(english ? "The default LUT could not be loaded." : "標準LUTを読み込めませんでした。")
            return response.text()
          }),
          listSessionAssets(sessionId),
        ])
        const restoredImages: GalleryImage[] = []
        const restoredLuts: GalleryLut[] = []
        for (const asset of storedAssets.sort((a, b) => a.createdAt - b.createdAt)) {
          if (asset.kind === "image") {
            restoredImages.push({
              id: asset.id,
              name: asset.name,
              src: createObjectUrl(asset.blob),
              uploaded: true,
            })
          } else {
            restoredLuts.push({
              id: asset.id,
              name: asset.name,
              lut: parseCube(await asset.blob.text(), asset.name),
              uploaded: true,
            })
          }
        }
        if (cancelled) return
        setImages([
          { id: DEFAULT_IMAGE_ID, name: english ? "Default Log image" : "標準Log素材", src: "/look-gallery/default-log.jpg", uploaded: false },
          ...restoredImages,
        ])
        setLuts([
          {
            id: DEFAULT_LUT_ID,
            name: "ARRI LogC to Video 709",
            lut: parseCube(defaultLutText, "ARRI LogC to Video 709"),
            uploaded: false,
          },
          ...restoredLuts,
        ])
        setMessage(restoredImages.length || restoredLuts.length
          ? (english ? "Restored assets for this tab" : "このタブの素材を復元しました")
          : (english ? "Ready with the default assets" : "標準素材で試せます"))
      } catch (error) {
        setMessage(error instanceof Error ? error.message : (english ? "The gallery could not be initialized." : "初期化できませんでした。"))
      }
    }
    void initialize()
    return () => {
      cancelled = true
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
      objectUrlsRef.current = []
    }
  }, [createObjectUrl, english])

  useEffect(() => {
    if (!selectedImageId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedImageId(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedImageId])

  const uploadedImageCount = images.filter((image) => image.uploaded).length
  const selectedImage = images.find((image) => image.id === selectedImageId) ?? null
  const selectedLutId = selectedImage
    ? imageLutIds[selectedImage.id] ?? batchLutId
    : batchLutId
  const selectedLut = luts.find((lut) => lut.id === selectedLutId)?.lut ?? null

  const lutOptions = useMemo(() => [
    { id: "none", name: english ? "No LUT" : "LUTなし" },
    ...luts.map((lut) => ({ id: lut.id, name: lut.name })),
  ], [english, luts])

  const handleImageUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const nextFiles = [...files]
    try {
      if (uploadedImageCount + nextFiles.length > MAX_UPLOAD_IMAGES) {
        throw new Error(english ? `You can add up to ${MAX_UPLOAD_IMAGES} images.` : `追加画像は最大${MAX_UPLOAD_IMAGES}枚です。`)
      }
      const sessionId = getTabSessionId()
      const additions: GalleryImage[] = []
      for (const file of nextFiles) {
        validateFileSize(file, english)
        if (!imageExtensionAllowed(file)) throw new Error(english ? `${file.name} is not a supported image format.` : `${file.name} は対応形式ではありません。`)
        const id = window.crypto.randomUUID()
        const asset: StoredLookAsset = {
          id,
          sessionId,
          kind: "image",
          name: file.name,
          blob: file,
          createdAt: Date.now(),
        }
        await saveSessionAsset(asset)
        additions.push({ id, name: file.name, src: createObjectUrl(file), uploaded: true })
      }
      setImages((current) => [...current, ...additions])
      setMessage(english ? `Added ${additions.length} image(s) to this tab` : `${additions.length}枚をこのタブへ追加しました`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (english ? "Images could not be added." : "画像を追加できませんでした。"))
    }
  }

  const handleLutUpload = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const sessionId = getTabSessionId()
      const additions: GalleryLut[] = []
      for (const file of [...files]) {
        validateFileSize(file, english)
        if (!file.name.toLowerCase().endsWith(".cube")) throw new Error(english ? `${file.name} is not a .cube file.` : `${file.name} は.cubeではありません。`)
        const parsed = parseCube(await file.text(), file.name)
        const id = window.crypto.randomUUID()
        await saveSessionAsset({
          id,
          sessionId,
          kind: "lut",
          name: file.name,
          blob: file,
          createdAt: Date.now(),
        })
        additions.push({ id, name: file.name, lut: parsed, uploaded: true })
      }
      setLuts((current) => [...current, ...additions])
      if (additions[0]) setBatchLutId(additions[0].id)
      setMessage(english ? `Added ${additions.length} LUT(s)` : `${additions.length}件のLUTを追加しました`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (english ? "LUTs could not be added." : "LUTを追加できませんでした。"))
    }
  }

  const removeImage = async (image: GalleryImage) => {
    if (!image.uploaded) return
    await deleteSessionAsset(image.id)
    setImages((current) => current.filter((item) => item.id !== image.id))
    setImageLutIds((current) => {
      const next = { ...current }
      delete next[image.id]
      return next
    })
    if (selectedImageId === image.id) setSelectedImageId(null)
    setMessage(english ? `Removed ${image.name} from this tab` : `${image.name}をこのタブから外しました`)
  }

  const saveProtectedPreview = () => {
    const canvas = modalCanvasRef.current
    if (!canvas || !selectedImage) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${selectedImage.name.replace(/\.[^.]+$/, "")}-protected-preview.png`
      anchor.click()
      URL.revokeObjectURL(url)
    }, "image/png")
  }

  return (
    <section id="look-gallery" className="hp-section-shell scroll-mt-24 md:scroll-mt-28">
      <div className="glass-card p-6 md:p-9 xl:p-10">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-hp-muted">Look preview</p>
          <h2 className="hp-heading mt-3 text-2xl font-semibold text-hp md:text-3xl">{english ? "Explore a look with LUTs" : "LUTでルックを確かめる"}</h2>
          <p className="hp-body mt-4 text-base text-hp-muted md:text-lg">
            {english ? "Compare Log images and .cube LUTs entirely in your browser. Added assets stay in this tab and are never sent to the server." : "Log素材と.cubeをブラウザ内で比較できます。追加素材はこのタブだけに保存され、サーバーへ送信されません。"}
          </p>
        </div>

        <div className="mt-7 grid gap-4 rounded-[12px] border border-white/55 bg-white/35 p-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-2 text-sm font-medium text-hp">
            {english ? "Add images" : "画像を追加"}
            <input
              className="block w-full text-sm text-hp-muted file:mr-3 file:rounded-full file:border-0 file:bg-[color:var(--hp-color-accent)] file:px-4 file:py-2 file:font-semibold file:text-white"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => void handleImageUpload(event.target.files)}
            />
            <span className="text-xs font-normal text-hp-muted">{english ? "JPEG, PNG, or WebP. Up to 50 MB each and 12 added images" : "JPEG、PNG、WebP。各50MB、追加12枚まで"}</span>
          </label>
          <label className="grid gap-2 text-sm font-medium text-hp">
            {english ? "Add LUTs" : "LUTを追加"}
            <input
              className="block w-full text-sm text-hp-muted file:mr-3 file:rounded-full file:border-0 file:bg-[color:var(--hp-color-accent)] file:px-4 file:py-2 file:font-semibold file:text-white"
              type="file"
              accept=".cube"
              multiple
              onChange={(event) => void handleLutUpload(event.target.files)}
            />
            <span className="text-xs font-normal text-hp-muted">{english ? ".cube only, up to 50 MB each" : ".cubeのみ、各50MBまで"}</span>
          </label>
          <label className="grid content-start gap-2 text-sm font-medium text-hp">
            {english ? "Batch LUT" : "一括LUT"}
            <select className="glass-input min-h-11 px-3 text-sm" value={batchLutId} onChange={(event) => setBatchLutId(event.target.value)}>
              {lutOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          <div className="grid content-start gap-2 text-sm font-medium text-hp">
            {english ? "Session" : "セッション"}
            <p className="min-h-11 rounded-[12px] border border-white/55 bg-white/40 px-3 py-3 text-sm font-normal text-hp-muted" aria-live="polite">
              {message}
            </p>
          </div>
        </div>

        <details className="mt-4 rounded-[12px] border border-white/55 bg-white/35 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-hp">{english ? "ACES preview settings" : "ACESプレビュー設定"}</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium text-hp">
              Source image
              <select className="glass-input min-h-11 px-3 text-sm" value={sourceTransform} onChange={(event) => setSourceTransform(event.target.value as SourceTransform)}>
                {Object.entries(localizedSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-hp">
              LUT target
              <select className="glass-input min-h-11 px-3 text-sm" value={lutTarget} onChange={(event) => setLutTarget(event.target.value as LutTarget)}>
                {Object.entries(localizedLutTargetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-hp">
              Output
              <select className="glass-input min-h-11 px-3 text-sm" value={outputTransform} onChange={(event) => setOutputTransform(event.target.value as OutputTransform)}>
                {Object.entries(localizedOutputLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs leading-6 text-hp-muted">
            {english ? "Set Source and LUT target to None, Output to No transform, and remove the LUT for a direct value passthrough. ACES SDR is a simplified viewing transform derived from the source tool." : "SourceとLUT targetを「指定なし」にし、Outputを「変換なし」、LUTも外すと色値はそのまま通過します。ACES SDRは元ツール由来の簡易表示変換です。"}
          </p>
        </details>

        <div className="mt-7 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,28rem),1fr))]">
          {images.map((image) => {
            const imageLutId = imageLutIds[image.id] ?? "batch"
            const effectiveLutId = imageLutId === "batch" ? batchLutId : imageLutId
            const effectiveLut = luts.find((lut) => lut.id === effectiveLutId)?.lut ?? null
            return (
              <article key={image.id} className="rounded-[12px] border border-white/55 bg-white/40 p-3 md:p-4">
                <button className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-color-accent-focus-outline)]" type="button" onClick={() => setSelectedImageId(image.id)}>
                  <PreviewCanvas image={image} lut={effectiveLut} sourceTransform={sourceTransform} outputTransform={outputTransform} />
                  <span className="mt-3 block truncate text-sm font-semibold text-hp">{image.name}</span>
                </button>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-hp-muted">
                    {english ? "LUT for this image" : "この画像のLUT"}
                    <select
                      className="glass-input min-h-10 px-3 text-sm text-hp"
                      value={imageLutId}
                      onChange={(event) => setImageLutIds((current) => ({ ...current, [image.id]: event.target.value }))}
                    >
                      <option value="batch">{english ? "Use batch setting" : "一括設定を使う"}</option>
                      {lutOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </label>
                  {image.uploaded ? (
                    <button className="glass-btn min-h-10 px-4 text-sm font-semibold text-hp" type="button" onClick={() => void removeImage(image)}>
                      {english ? "Remove" : "外す"}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </div>

      {selectedImage ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/60 p-3 md:p-8" role="dialog" aria-modal="true" aria-label={english ? `Details for ${selectedImage.name}` : `${selectedImage.name}の詳細`} onMouseDown={(event) => {
          if (event.currentTarget === event.target) setSelectedImageId(null)
        }}>
          <div className="mx-auto max-w-6xl rounded-[20px] border border-white/55 bg-[color:var(--hp-color-surface)] p-4 shadow-2xl md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="hp-heading truncate text-xl font-semibold text-hp md:text-2xl">{selectedImage.name}</h3>
                <p className="mt-2 text-xs leading-5 text-hp-muted">
                  Source: {localizedSourceLabels[sourceTransform]}<br />
                  LUT: {luts.find((lut) => lut.id === selectedLutId)?.name ?? (english ? "No LUT" : "LUTなし")}<br />
                  LUT target: {localizedLutTargetLabels[lutTarget]}<br />
                  Output: {localizedOutputLabels[outputTransform]}
                </p>
              </div>
              <button className="glass-btn min-h-10 shrink-0 px-4 text-sm font-semibold text-hp" type="button" onClick={() => setSelectedImageId(null)}>{english ? "Close" : "閉じる"}</button>
            </div>
            <div className="mt-5">
              <PreviewCanvas canvasRef={modalCanvasRef} image={selectedImage} lut={selectedLut} sourceTransform={sourceTransform} outputTransform={outputTransform} large />
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="grid min-w-0 gap-1 text-xs font-medium text-hp-muted sm:w-80">
                {english ? "LUT for this image" : "この画像のLUT"}
                <select
                  className="glass-input min-h-11 px-3 text-sm text-hp"
                  value={imageLutIds[selectedImage.id] ?? "batch"}
                  onChange={(event) => setImageLutIds((current) => ({ ...current, [selectedImage.id]: event.target.value }))}
                >
                  <option value="batch">{english ? "Use batch setting" : "一括設定を使う"}</option>
                  {lutOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <button className="glass-btn min-h-11 px-5 text-sm font-semibold text-hp" type="button" onClick={saveProtectedPreview}>{english ? "Save protected preview" : "保護プレビューを保存"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
