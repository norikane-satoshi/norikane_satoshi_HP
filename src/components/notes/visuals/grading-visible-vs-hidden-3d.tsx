"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

const NAVY = "rgb(42,79,143)"
const MAGENTA_THREE = new THREE.Color(0.7529, 0.2902, 0.5569)
const NAVY_THREE = new THREE.Color(0.1647, 0.3098, 0.5608)
const AMBER_THREE = new THREE.Color(0.7843, 0.5725, 0.2275)
const TEAL_THREE = new THREE.Color(0.1804, 0.5490, 0.5176)

type ClusterDef = {
  id: "S1" | "S2" | "S3" | "S4"
  index: number
  centerAngle: number
  centerRadius: number
  centerY: number
  spreadXZ: number
  spreadY: number
}

const CLUSTERS: ClusterDef[] = [
  { id: "S1", index: 0, centerAngle: Math.PI * 0.18, centerRadius: 0.58, centerY: -0.5, spreadXZ: 0.16, spreadY: 0.18 },
  { id: "S2", index: 1, centerAngle: Math.PI * 0.7, centerRadius: 0.82, centerY: -0.12, spreadXZ: 0.3, spreadY: 0.26 },
  { id: "S3", index: 2, centerAngle: Math.PI * 1.18, centerRadius: 0.62, centerY: 0.18, spreadXZ: 0.2, spreadY: 0.55 },
  { id: "S4", index: 3, centerAngle: Math.PI * 1.68, centerRadius: 0.92, centerY: 0.5, spreadXZ: 0.48, spreadY: 0.42 },
]

const CYCLE_SECONDS = 18

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

const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  attribute vec3 aOffset;
  attribute vec3 aCenter;
  attribute vec3 aBaseColor;
  attribute float aClusterIdx;
  attribute float aSeed;

  uniform float uTime;
  uniform vec4 uActive;
  uniform float uPulseR;
  uniform float uPulseY;
  uniform float uDrift;
  uniform float uPointSize;
  uniform vec3 uAccentS1;
  uniform vec3 uAccentS2;
  uniform vec3 uAccentS3;
  uniform vec3 uAccentS4;

  varying vec3 vColor;
  varying float vOpacity;

  float pickActive(float idx) {
    if (idx < 0.5) return uActive.x;
    if (idx < 1.5) return uActive.y;
    if (idx < 2.5) return uActive.z;
    return uActive.w;
  }

  vec3 pickAccent(float idx) {
    if (idx < 0.5) return uAccentS1;
    if (idx < 1.5) return uAccentS2;
    if (idx < 2.5) return uAccentS3;
    return uAccentS4;
  }

  void main() {
    float actI = pickActive(aClusterIdx);

    bool isRadial = (aClusterIdx > 0.5 && aClusterIdx < 1.5) || aClusterIdx > 2.5;
    bool isVertical = (aClusterIdx > 1.5);

    float radialGain = isRadial ? mix(1.0, 1.4, uPulseR * (0.55 + 0.45 * actI)) : 1.0;
    float verticalGain = isVertical ? mix(1.0, 1.5, uPulseY * (0.55 + 0.45 * actI)) : 1.0;

    vec3 offset = aOffset;
    offset.xz *= radialGain;
    offset.y *= verticalGain;

    bool isDrift = aClusterIdx > 2.5;
    vec3 center = aCenter;
    if (isDrift) {
      float driftPhase = uTime * 0.5 + aSeed * 2.0;
      center.x += sin(driftPhase) * 0.22 * uDrift;
      center.z += cos(driftPhase * 0.83) * 0.18 * uDrift;
    }

    vec3 wobble = vec3(
      sin(uTime * 0.7 + aSeed * 6.28 + aOffset.y * 4.0) * 0.022,
      cos(uTime * 0.55 + aSeed * 3.91 + aOffset.x * 3.5) * 0.024,
      sin(uTime * 0.93 + aSeed * 4.77 + aOffset.z * 5.0) * 0.022
    );

    vec3 worldPos = center + offset + wobble;
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float sizeFactor = mix(0.85, 1.95, actI);
    float dist = max(-mvPos.z, 0.4);
    gl_PointSize = uPointSize * sizeFactor * (1.0 / dist);

    vec3 accent = pickAccent(aClusterIdx);
    vec3 highlighted = mix(aBaseColor, accent, 0.42);
    vColor = mix(aBaseColor, highlighted, actI);
    vOpacity = mix(0.32, 0.95, actI);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.18, d) * vOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`

type ParticleBundle = {
  geometry: THREE.BufferGeometry
  material: THREE.ShaderMaterial
}

function buildBundle(perCluster: number): ParticleBundle {
  const total = perCluster * CLUSTERS.length
  const offsets = new Float32Array(total * 3)
  const centers = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const indices = new Float32Array(total)
  const seeds = new Float32Array(total)

  CLUSTERS.forEach((cluster) => {
    const rng = mulberry32(cluster.id.charCodeAt(1) * 7919 + perCluster)
    const cx = Math.cos(cluster.centerAngle) * cluster.centerRadius
    const cz = Math.sin(cluster.centerAngle) * cluster.centerRadius
    for (let i = 0; i < perCluster; i += 1) {
      const slot = cluster.index * perCluster + i
      const dx = gauss(rng) * cluster.spreadXZ
      const dz = gauss(rng) * cluster.spreadXZ
      const dy = gauss(rng) * cluster.spreadY
      offsets[slot * 3 + 0] = dx
      offsets[slot * 3 + 1] = dy
      offsets[slot * 3 + 2] = dz
      centers[slot * 3 + 0] = cx
      centers[slot * 3 + 1] = cluster.centerY
      centers[slot * 3 + 2] = cz

      const radial = Math.min(1, Math.hypot(dx, dz) / Math.max(cluster.spreadXZ, 0.001))
      const vertical = Math.min(1, Math.abs(dy) / Math.max(cluster.spreadY, 0.001))
      const mix = THREE.MathUtils.clamp(
        radial * 0.62 + vertical * 0.42 + (rng() - 0.5) * 0.18,
        0,
        1,
      )
      const c = new THREE.Color().lerpColors(NAVY_THREE, MAGENTA_THREE, mix)
      colors[slot * 3 + 0] = c.r
      colors[slot * 3 + 1] = c.g
      colors[slot * 3 + 2] = c.b

      indices[slot] = cluster.index
      seeds[slot] = rng()
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3))
  geometry.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 3))
  geometry.setAttribute("aCenter", new THREE.BufferAttribute(centers, 3))
  geometry.setAttribute("aBaseColor", new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute("aClusterIdx", new THREE.BufferAttribute(indices, 1))
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4)

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uActive: { value: new THREE.Vector4(1, 0, 0, 0) },
      uPulseR: { value: 0 },
      uPulseY: { value: 0 },
      uDrift: { value: 0 },
      uPointSize: { value: 28 },
      uAccentS1: { value: TEAL_THREE.clone() },
      uAccentS2: { value: MAGENTA_THREE.clone() },
      uAccentS3: { value: NAVY_THREE.clone() },
      uAccentS4: { value: AMBER_THREE.clone() },
    },
  })

  return { geometry, material }
}

function ClusterParticles({
  perCluster,
  materialRef,
}: {
  perCluster: number
  materialRef: React.MutableRefObject<THREE.ShaderMaterial | null>
}) {
  const bundle = useMemo(() => buildBundle(perCluster), [perCluster])

  useEffect(() => {
    materialRef.current = bundle.material
    return () => {
      if (materialRef.current === bundle.material) materialRef.current = null
      bundle.geometry.dispose()
      bundle.material.dispose()
    }
  }, [bundle, materialRef])

  return (
    <points geometry={bundle.geometry} material={bundle.material} frustumCulled={false} />
  )
}

function CylinderFrame({
  ringRefs,
  axisRef,
}: {
  ringRefs: React.MutableRefObject<(THREE.LineBasicMaterial | null)[]>
  axisRef: React.MutableRefObject<THREE.MeshBasicMaterial | null>
}) {
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

  const setRingRef = (idx: number) => (mat: THREE.LineBasicMaterial | null) => {
    ringRefs.current[idx] = mat
  }

  return (
    <>
      <group position={[0, -0.78, 0]}>
        <line>
          <primitive object={ringGeometry} attach="geometry" />
          <lineBasicMaterial ref={setRingRef(0)} color="#8B7FFF" transparent opacity={0.42} />
        </line>
      </group>
      <group position={[0, 0, 0]}>
        <line>
          <primitive object={ringGeometry} attach="geometry" />
          <lineBasicMaterial ref={setRingRef(1)} color="#8B7FFF" transparent opacity={0.22} />
        </line>
      </group>
      <group position={[0, 0.78, 0]}>
        <line>
          <primitive object={ringGeometry} attach="geometry" />
          <lineBasicMaterial ref={setRingRef(2)} color="#8B7FFF" transparent opacity={0.42} />
        </line>
      </group>
      <mesh>
        <cylinderGeometry args={[0.006, 0.006, 1.6, 6]} />
        <meshBasicMaterial ref={axisRef} color={NAVY} transparent opacity={0.55} />
      </mesh>
    </>
  )
}

function smoothPulse(phase: number, target: number) {
  const span = 1.0
  let d = phase - target
  if (d > 2) d -= 4
  if (d < -2) d += 4
  const ad = Math.abs(d)
  if (ad >= span) return 0
  const t = 1 - ad / span
  return t * t * (3 - 2 * t)
}

function RotatingScene({
  particleCount,
  reducedMotion,
}: {
  particleCount: number
  reducedMotion: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const ringRefs = useRef<(THREE.LineBasicMaterial | null)[]>([null, null, null])
  const axisRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)

  const applyBaseline = () => {
    if (materialRef.current) {
      const u = materialRef.current.uniforms
      u.uTime.value = 0
      u.uActive.value.set(0.55, 0.55, 0.55, 0.55)
      u.uPulseR.value = 0
      u.uPulseY.value = 0
      u.uDrift.value = 0
    }
    if (ringRefs.current[0]) ringRefs.current[0]!.opacity = 0.42
    if (ringRefs.current[1]) ringRefs.current[1]!.opacity = 0.22
    if (ringRefs.current[2]) ringRefs.current[2]!.opacity = 0.42
    if (axisRef.current) axisRef.current.opacity = 0.55
  }

  useEffect(() => {
    if (reducedMotion) {
      applyBaseline()
      invalidate()
    } else {
      startTimeRef.current = null
    }
  }, [reducedMotion, invalidate])

  useFrame((state, dt) => {
    if (!groupRef.current) return
    if (reducedMotion) return

    groupRef.current.rotation.y += dt * 0.085

    if (startTimeRef.current === null) startTimeRef.current = state.clock.elapsedTime
    const t = state.clock.elapsedTime - startTimeRef.current

    const phase = ((t % CYCLE_SECONDS) / CYCLE_SECONDS) * 4
    const a0 = smoothPulse(phase, 0)
    const a1 = smoothPulse(phase, 1)
    const a2 = smoothPulse(phase, 2)
    const a3 = smoothPulse(phase, 3)

    if (materialRef.current) {
      const u = materialRef.current.uniforms
      u.uTime.value = t
      u.uActive.value.set(a0, a1, a2, a3)
      u.uPulseR.value = a1 + a3
      u.uPulseY.value = a2 + a3
      u.uDrift.value = a3
    }

    const ringPulse = Math.sin((t / 6) * Math.PI * 2)
    const ringEdge = 0.42 + 0.045 * ringPulse
    const ringMid = 0.22 + 0.03 * ringPulse
    if (ringRefs.current[0]) ringRefs.current[0]!.opacity = ringEdge
    if (ringRefs.current[1]) ringRefs.current[1]!.opacity = ringMid
    if (ringRefs.current[2]) ringRefs.current[2]!.opacity = ringEdge

    const navyBoost = 0.55 * Math.max(a2, a3)
    if (axisRef.current) axisRef.current.opacity = 0.42 + 0.18 * (0.5 + 0.5 * ringPulse) + navyBoost * 0.35
  })

  const perCluster = Math.max(40, Math.floor(particleCount / CLUSTERS.length))

  return (
    <group ref={groupRef}>
      <CylinderFrame ringRefs={ringRefs} axisRef={axisRef} />
      <ClusterParticles perCluster={perCluster} materialRef={materialRef} />
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
    <div className="absolute inset-0">
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
    </div>
  )
}
