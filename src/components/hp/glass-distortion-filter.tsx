"use client";

import { useEffect } from "react";

const FILTER_ID = "hp-liquid-glass-distortion";
const ENABLED_CLASS = "hp-liquid-glass-enabled";

function supportsBackdropSvgFilter() {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return false;
  }

  const filterValue = `url("#${FILTER_ID}") blur(1px)`;
  return (
    CSS.supports("backdrop-filter", filterValue) ||
    CSS.supports("-webkit-backdrop-filter", filterValue)
  );
}

export function GlassDistortionFilter() {
  useEffect(() => {
    const root = document.documentElement;
    const isEnabled = supportsBackdropSvgFilter();

    root.classList.toggle(ENABLED_CLASS, isEnabled);
    return () => root.classList.remove(ENABLED_CLASS);
  }, []);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      width="0"
    >
      <filter
        id={FILTER_ID}
        x="-12%"
        y="-12%"
        width="124%"
        height="124%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.018 0.036"
          numOctaves="2"
          seed="17"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="18"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
