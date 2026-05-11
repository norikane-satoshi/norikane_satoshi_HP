"use client"

import { Canvas, useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

const MAGENTA = "rgb(192,74,142)"
const NAVY = "rgb(42,79,143)"
const MAGENTA_THREE = new THREE.Color(0.7529, 0.2902, 0.5569)
const NAVY_THREE = new THREE.Color(0.1647, 0.3098, 0.5608)

const FONT_FAMILY = "var(--font-noto-sans-jp), sans-serif"
const MONO = "var(--font-geist-mono), ui-monospace, monospace"
const TEXT_PRIMARY = "#1C0F6E"
const TEXT_MUTED = "#6B5FA8"
const GLASS_FILL = "rgba(255,255,255,0.65)"
const GLASS_STROKE = "rgba(255,255,255,0.78)"

const HEADER_VIEWBOX_W = 1600
const HEADER_VIEWBOX_H = 60
const CARD_R = 14

type ClusterDef = {
  id: "S1" | "S2" | "S3" | "S4"
  centerAngle: number
  centerRadius: number
  centerY: number
  spreadXZ: number
  spreadY: number
  blurb: string
}

const CLUSTERS: ClusterDef[] = [
  {
    id: "S1",
    centerAngle: Math.PI * 0.18,
    centerRadius: 0.58,
    centerY: -0.5,
    spreadXZ: 0.16,
    spreadY: 0.18,
    blurb: "引き締まり",
  },
  {
    id: "S2",
    centerAngle: Math.PI * 0.7,
    centerRadius: 0.82,
    centerY: -0.12,
    spreadXZ: 0.3,
    spreadY: 0.26,
    blurb: "広がりが出る",
  },
  {
    id: "S3",
    centerAngle: Math.PI * 1.18,
    centerRadius: 0.62,
    centerY: 0.18,
    spreadXZ: 0.2,
    spreadY: 0.55,
    blurb: "濃度が縦に伸びる",
  },
  {
    id: "S4",
    centerAngle: Math.PI * 1.68,
    centerRadius: 0.92,
    centerY: 0.5,
    spreadXZ: 0.48,
    spreadY: 0.42,
    blurb: "広がりと濃度が同時にドリフト",
  },
]

function pickParticleCount(width: number): number {
  if (width >= 1280) return 2400
  if (width >= 768) return 1000
  return 500
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rng: () => number) {
  return (rng() + rng() + rng() + rng() - 2) / 1.5
}

function ClusterPoints({
  cluster,
  count,
}: {
  cluster: ClusterDef
  count: number
}) {
  const geometry = useMemo(() => {
    const rng = mulberry32(cluster.id.charCodeAt(1) * 7919 + count)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const cx = Math.cos(cluster.centerAngle) * cluster.centerRadius
    const cz = Math.sin(cluster.centerAngle) * cluster.centerRadius
    for (let i = 0; i < count; i += 1) {
      const dx = gauss(rng) * cluster.spreadXZ
      const dz = gauss(rng) * cluster.spreadXZ
      const dy = gauss(rng) * cluster.spreadY
      positions[i * 3 + 0] = cx + dx
      positions[i * 3 + 1] = cluster.centerY + dy
      positions[i * 3 + 2] = cz + dz

      const radial = Math.min(1, Math.hypot(dx, dz) / Math.max(cluster.spreadXZ, 0.001))
      const vertical = Math.min(1, Math.abs(dy) / Math.max(cluster.spreadY, 0.001))
      const mix = THREE.MathUtils.clamp(
        radial * 0.62 + vertical * 0.42 + (rng() - 0.5) * 0.18,
        0,
        1,
      )
      const c = new THREE.Color().lerpColors(NAVY_THREE, MAGENTA_THREE, mix)
      colors[i * 3 + 0] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    return g
  }, [cluster, count])

  useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        vertexColors
        size={0.045}
        sizeAttenuation
        transparent
        opacity={0.82}
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  )
}

function ClusterMarker({ cluster }: { cluster: ClusterDef }) {
  const cx = Math.cos(cluster.centerAngle) * cluster.centerRadius
  const cz = Math.sin(cluster.centerAngle) * cluster.centerRadius
  const cy = cluster.centerY + cluster.spreadY + 0.18
  return (
    <mesh position={[cx, cy, cz]}>
      <sphereGeometry args={[0.04, 16, 16]} />
      <meshBasicMaterial color="#1C0F6E" transparent opacity={0.85} />
    </mesh>
  )
}

function CylinderFrame() {
  const ringGeometry = useMemo(() => {
    const segments = 96
    const positions = new Float32Array((segments + 1) * 3)
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * Math.PI * 2
      positions[i * 3 + 0] = Math.cos(t)
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = Math.sin(t)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    return g
  }, [])

  useEffect(() => {
    return () => {
      ringGeometry.dispose()
    }
  }, [ringGeometry])

  return (
    <>
      <group position={[0, -0.78, 0]}>
        <line>
          <primitive object={ringGeometry} attach="geometry" />
          <lineBasicMaterial color="#8B7FFF" transparent opacity={0.42} />
        </line>
      </group>
      <group position={[0, 0, 0]}>
        <line>
          <primitive object={ringGeometry} attach="geometry" />
          <lineBasicMaterial color="#8B7FFF" transparent opacity={0.22} />
        </line>
      </group>
      <group position={[0, 0.78, 0]}>
        <line>
          <primitive object={ringGeometry} attach="geometry" />
          <lineBasicMaterial color="#8B7FFF" transparent opacity={0.42} />
        </line>
      </group>
      <mesh>
        <cylinderGeometry args={[0.006, 0.006, 1.6, 6]} />
        <meshBasicMaterial color={NAVY} transparent opacity={0.55} />
      </mesh>
    </>
  )
}

function RotatingScene({
  particleCount,
  reducedMotion,
}: {
  particleCount: number
  reducedMotion: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (reducedMotion || !groupRef.current) return
    groupRef.current.rotation.y += dt * 0.085
  })
  const perCluster = Math.max(40, Math.floor(particleCount / CLUSTERS.length))
  return (
    <group ref={groupRef}>
      <CylinderFrame />
      {CLUSTERS.map((c) => (
        <ClusterPoints key={c.id} cluster={c} count={perCluster} />
      ))}
      {CLUSTERS.map((c) => (
        <ClusterMarker key={`marker-${c.id}`} cluster={c} />
      ))}
    </group>
  )
}

function useParticleCount() {
  const [count, setCount] = useState<number>(() => {
    if (typeof window === "undefined") return 1000
    return pickParticleCount(window.innerWidth)
  })
  useEffect(() => {
    const onResize = () => setCount(pickParticleCount(window.innerWidth))
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return count
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return reduced
}

export default function GradingVisibleVsHidden3D() {
  const particleCount = useParticleCount()
  const reducedMotion = useReducedMotion()

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative w-full" style={{ flex: "0 0 24%" }}>
        <PreparedHeaderSvg />
      </div>
      <div className="relative w-full flex-1">
        <Canvas
          camera={{ position: [2.6, 1.4, 3.1], fov: 36 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          dpr={[1, 1.8]}
          style={{ background: "transparent" }}
          frameloop={reducedMotion ? "demand" : "always"}
        >
          <RotatingScene
            particleCount={particleCount}
            reducedMotion={reducedMotion}
          />
        </Canvas>
        <LegendOverlay />
        <AxisAnnotation />
      </div>
    </div>
  )
}

function LegendOverlay() {
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 right-2 grid grid-cols-2 gap-1 text-[10px] sm:grid-cols-4 sm:text-[11px]"
      style={{ fontFamily: FONT_FAMILY, color: TEXT_PRIMARY }}
      aria-hidden="true"
    >
      {CLUSTERS.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-1.5 rounded-md border border-white/55 bg-white/60 px-2 py-1 backdrop-blur-sm"
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 8,
              height: 8,
              background: c.id === "S2" || c.id === "S4" ? MAGENTA : NAVY,
              opacity: 0.85,
            }}
          />
          <span className="font-semibold" style={{ fontFamily: MONO, letterSpacing: "0.08em" }}>
            {c.id}
          </span>
          <span style={{ color: TEXT_MUTED }}>{c.blurb}</span>
        </div>
      ))}
    </div>
  )
}

function AxisAnnotation() {
  return (
    <div
      className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1 text-[10px] sm:text-[11px]"
      style={{ fontFamily: FONT_FAMILY }}
      aria-hidden="true"
    >
      <span
        className="rounded-md border border-white/55 bg-white/60 px-2 py-0.5 backdrop-blur-sm"
        style={{ color: NAVY }}
      >
        縦軸 = 濃度
      </span>
      <span
        className="rounded-md border border-white/55 bg-white/60 px-2 py-0.5 backdrop-blur-sm"
        style={{ color: MAGENTA }}
      >
        円周方向 = 色の広がり
      </span>
    </div>
  )
}

function PreparedHeaderSvg() {
  const x = 50
  const y = 12
  const w = HEADER_VIEWBOX_W - x * 2
  const h = HEADER_VIEWBOX_H - 22
  const badgeW = 124
  return (
    <svg
      viewBox={`0 0 ${HEADER_VIEWBOX_W} ${HEADER_VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      fontFamily={FONT_FAMILY}
    >
      <defs>
        <filter id="gvh3d-badge-shadow" x="-6%" y="-30%" width="112%" height="160%">
          <feDropShadow dx={0} dy={4} stdDeviation={10} floodColor="#8B7FFF" floodOpacity={0.12} />
        </filter>
      </defs>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={CARD_R}
        fill={GLASS_FILL}
        stroke={GLASS_STROKE}
        strokeWidth={1}
        filter="url(#gvh3d-badge-shadow)"
      />
      <rect
        x={x + 16}
        y={y + 10}
        width={badgeW}
        height={h - 20}
        rx={(h - 20) / 2}
        fill={MAGENTA}
        opacity={0.92}
      />
      <text
        x={x + 16 + badgeW / 2}
        y={y + h / 2 + 6}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={17}
        fontWeight={700}
        letterSpacing="0.06em"
      >
        仕込み
      </text>
      <text
        x={x + 16 + badgeW + 20}
        y={y + h / 2 + 6}
        fill={TEXT_PRIMARY}
        fontSize={17}
        fontWeight={600}
      >
        ツール上では見えない ─ シーンを跨いで分かる
      </text>
      <text
        x={x + w - 18}
        y={y + h / 2 + 4}
        textAnchor="end"
        fill={MAGENTA}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.22em"
      >
        TOOL-HIDDEN / SLOW
      </text>
    </svg>
  )
}
