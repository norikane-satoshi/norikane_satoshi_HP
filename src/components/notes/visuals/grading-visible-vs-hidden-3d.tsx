"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

const LEFT_SPREAD_PERIOD_SEC = 10.0
const LEFT_SPREAD_FREQ = (2.0 * Math.PI) / LEFT_SPREAD_PERIOD_SEC
const LEFT_SPREAD_AMP = 0.5

const LEFT_TWIST_PERIOD_SEC = 14.0
const LEFT_TWIST_FREQ = (2.0 * Math.PI) / LEFT_TWIST_PERIOD_SEC
const LEFT_TWIST_AMP = 1.2

const LEFT_ROTATION_Y_RAD_PER_SEC = 0.12

const RIGHT_WAVE_PERIOD_SEC = 6.0
const RIGHT_WAVE_TIME_FREQ = (2.0 * Math.PI) / RIGHT_WAVE_PERIOD_SEC
const RIGHT_WAVE_THETA_FREQ = 5.0
const RIGHT_WAVE_AMP = 0.25

const RIGHT_ROTATION_Y_RAD_PER_SEC = 0.08

const IDLE_DRIFT_AMP = 0.025

type NodeKind = "left" | "right"

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

const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  attribute float aTheta;
  attribute float aRadius;
  attribute float aBaseY;
  attribute float aSeed;
  attribute vec3 aBaseColor;

  uniform float uTime;
  uniform float uIsLeft;
  uniform float uSpread;
  uniform float uTwistAmp;
  uniform float uTwistFreq;
  uniform float uWaveAmp;
  uniform float uWaveTimeFreq;
  uniform float uWaveThetaFreq;
  uniform float uDrift;
  uniform float uPointSize;

  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float theta = aTheta;
    float radius = aRadius;
    float y = aBaseY;
    float waveBoost = 0.0;

    if (uIsLeft > 0.5) {
      radius *= uSpread;
      theta += uTwistAmp * y * sin(uTime * uTwistFreq);
    } else {
      float fade = smoothstep(0.6, 0.0, abs(y));
      float wave = sin(theta * uWaveThetaFreq + uTime * uWaveTimeFreq);
      y += uWaveAmp * wave * fade;
      waveBoost = max(0.0, wave) * fade;
    }

    vec3 drift = vec3(
      sin(uTime * 0.7 + aSeed * 6.2831853) * uDrift,
      cos(uTime * 0.55 + aSeed * 3.9148292) * uDrift,
      sin(uTime * 0.93 + aSeed * 4.7715271) * uDrift
    );

    vec3 worldPos = vec3(
      radius * cos(theta) + drift.x,
      y + drift.y,
      radius * sin(theta) + drift.z
    );

    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float dist = max(-mvPos.z, 0.4);
    gl_PointSize = uPointSize * (1.0 / dist);

    vec3 boosted = mix(aBaseColor, vec3(1.0), 0.28);
    vColor = mix(aBaseColor, boosted, waveBoost);
    vOpacity = mix(0.72, 0.95, waveBoost);
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

function buildBundle(count: number, kind: NodeKind): ParticleBundle {
  const total = Math.max(60, count)
  const positions = new Float32Array(total * 3)
  const thetas = new Float32Array(total)
  const radii = new Float32Array(total)
  const baseY = new Float32Array(total)
  const seeds = new Float32Array(total)
  const colors = new Float32Array(total * 3)

  const rng = mulberry32(kind === "left" ? 1481 + total : 2729 + total)
  const radiusMin = 0.02
  const radiusSpan = 0.88
  const yLimit = 0.92

  for (let i = 0; i < total; i += 1) {
    const theta = rng() * Math.PI * 2
    const r01 = rng() * rng()
    const radius = radiusMin + r01 * radiusSpan
    const y = (rng() * 2 - 1) * yLimit
    thetas[i] = theta
    radii[i] = radius
    baseY[i] = y
    seeds[i] = rng()

    const h = theta / (Math.PI * 2)
    const s = THREE.MathUtils.clamp((radius - radiusMin) / radiusSpan, 0, 1)
    const l = THREE.MathUtils.clamp((y / yLimit + 1) * 0.5, 0, 1)
    const c = new THREE.Color().setHSL(h, s, l)
    colors[i * 3 + 0] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("aTheta", new THREE.BufferAttribute(thetas, 1))
  geometry.setAttribute("aRadius", new THREE.BufferAttribute(radii, 1))
  geometry.setAttribute("aBaseY", new THREE.BufferAttribute(baseY, 1))
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1))
  geometry.setAttribute("aBaseColor", new THREE.BufferAttribute(colors, 3))
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3)

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uIsLeft: { value: kind === "left" ? 1.0 : 0.0 },
      uSpread: { value: 1.0 },
      uTwistAmp: { value: kind === "left" ? LEFT_TWIST_AMP : 0.0 },
      uTwistFreq: { value: LEFT_TWIST_FREQ },
      uWaveAmp: { value: kind === "right" ? RIGHT_WAVE_AMP : 0.0 },
      uWaveTimeFreq: { value: RIGHT_WAVE_TIME_FREQ },
      uWaveThetaFreq: { value: RIGHT_WAVE_THETA_FREQ },
      uDrift: { value: IDLE_DRIFT_AMP },
      uPointSize: { value: 24 },
    },
  })

  return { geometry, material }
}

function NodeParticles({
  count,
  kind,
  reducedMotion,
}: {
  count: number
  kind: NodeKind
  reducedMotion: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const startTimeRef = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)

  const bundle = useMemo(() => buildBundle(count, kind), [count, kind])
  const bundleRef = useRef(bundle)

  useEffect(() => {
    bundleRef.current = bundle
    return () => {
      bundle.geometry.dispose()
      bundle.material.dispose()
    }
  }, [bundle])

  useEffect(() => {
    if (reducedMotion) {
      const u = bundleRef.current.material.uniforms
      u.uTime.value = 0
      u.uSpread.value = 1.0
      if (groupRef.current) {
        groupRef.current.rotation.set(0, 0, 0)
      }
      invalidate()
    } else {
      startTimeRef.current = null
    }
  }, [reducedMotion, bundle, invalidate])

  useFrame((state, dt) => {
    if (reducedMotion) return
    if (!groupRef.current) return

    if (startTimeRef.current === null) startTimeRef.current = state.clock.elapsedTime
    const t = state.clock.elapsedTime - startTimeRef.current

    const u = bundleRef.current.material.uniforms
    u.uTime.value = t

    if (kind === "left") {
      groupRef.current.rotation.y += dt * LEFT_ROTATION_Y_RAD_PER_SEC
      u.uSpread.value = 1.0 + LEFT_SPREAD_AMP * Math.sin(t * LEFT_SPREAD_FREQ)
    } else {
      groupRef.current.rotation.y += dt * RIGHT_ROTATION_Y_RAD_PER_SEC
    }
  })

  return (
    <group ref={groupRef}>
      <points geometry={bundle.geometry} material={bundle.material} frustumCulled={false} />
    </group>
  )
}

const AXIS_VERTEX_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const AXIS_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(mix(vec3(0.0), vec3(1.0), vUv.y), 0.65);
  }
`

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

  const axisMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: AXIS_VERTEX_SHADER,
        fragmentShader: AXIS_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
      }),
    [],
  )

  useEffect(() => {
    return () => {
      ringGeometry.dispose()
      axisMaterial.dispose()
    }
  }, [ringGeometry, axisMaterial])

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
      <mesh material={axisMaterial}>
        <cylinderGeometry args={[0.006, 0.006, 1.6, 6]} />
      </mesh>
    </>
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

function NodeCanvas({
  kind,
  reducedMotion,
  count,
}: {
  kind: NodeKind
  reducedMotion: boolean
  count: number
}) {
  return (
    <Canvas
      camera={{ position: [2.6, 1.4, 3.1], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 1.8]}
      style={{ background: "transparent" }}
      frameloop={reducedMotion ? "demand" : "always"}
    >
      <CylinderFrame />
      <NodeParticles count={count} kind={kind} reducedMotion={reducedMotion} />
    </Canvas>
  )
}

function HiddenCanvas({ kind }: { kind: NodeKind }) {
  const reducedMotion = useReducedMotion()
  const count = useParticleCount()

  return (
    <div className="relative h-full w-full">
      <NodeCanvas kind={kind} reducedMotion={reducedMotion} count={count} />
    </div>
  )
}

export function HiddenLeftCanvas() {
  return <HiddenCanvas kind="left" />
}

export function HiddenRightCanvas() {
  return <HiddenCanvas kind="right" />
}

export default function GradingVisibleVsHidden3D() {
  return (
    <>
      <HiddenLeftCanvas />
      <HiddenRightCanvas />
    </>
  )
}
