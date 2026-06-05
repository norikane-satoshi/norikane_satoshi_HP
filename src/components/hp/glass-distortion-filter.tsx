"use client";

import { useEffect } from "react";

const FILTER_ID = "hp-liquid-glass-distortion";
const PROFILE_LENS_FILTER_ID = "hp-profile-lens-distortion";
const ENABLED_CLASS = "hp-liquid-glass-enabled";
const PROFILE_LENS_THICKNESS_SCALE = 26;
const PROFILE_LENS_DISPERSION_SCALE = 3;
const PROFILE_LENS_MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" preserveAspectRatio="none"><defs><radialGradient id="lens" cx="50%" cy="48%" r="74%"><stop offset="0%" stop-color="rgb(128,128,128)"/><stop offset="48%" stop-color="rgb(129,128,127)"/><stop offset="68%" stop-color="rgb(134,126,122)"/><stop offset="82%" stop-color="rgb(106,134,148)"/><stop offset="100%" stop-color="rgb(78,146,172)"/></radialGradient><radialGradient id="bevel" cx="50%" cy="50%" r="77%"><stop offset="0%" stop-color="rgba(128,128,128,0)"/><stop offset="66%" stop-color="rgba(128,128,128,0)"/><stop offset="76%" stop-color="rgba(174,144,112,0.30)"/><stop offset="88%" stop-color="rgba(96,134,160,0.48)"/><stop offset="100%" stop-color="rgba(58,150,190,0.64)"/></radialGradient><linearGradient id="axis" x1="8%" y1="0%" x2="92%" y2="100%"><stop offset="0%" stop-color="rgba(172,118,102,0.36)"/><stop offset="44%" stop-color="rgba(128,128,128,0)"/><stop offset="58%" stop-color="rgba(128,128,128,0)"/><stop offset="100%" stop-color="rgba(82,150,178,0.38)"/></linearGradient></defs><rect width="256" height="256" fill="rgb(128,128,128)"/><ellipse cx="128" cy="128" rx="122" ry="110" fill="url(#lens)"/><ellipse cx="128" cy="128" rx="126" ry="115" fill="url(#bevel)"/><rect width="256" height="256" fill="url(#axis)"/></svg>`;
const PROFILE_LENS_MAP_DATA_URI = `data:image/svg+xml,${encodeURIComponent(PROFILE_LENS_MAP_SVG)}`;

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
          scale="28"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter
        id={PROFILE_LENS_FILTER_ID}
        x="-10%"
        y="-10%"
        width="120%"
        height="120%"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          href={PROFILE_LENS_MAP_DATA_URI}
          x="0"
          y="0"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          result="profileLensMap"
        />
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.072 0.108"
          numOctaves="1"
          seed="29"
          result="profileNoise"
        />
        <feComponentTransfer in="profileNoise" result="profileMicroRipple">
          <feFuncR type="linear" slope="0.18" intercept="0.41" />
          <feFuncG type="linear" slope="0.18" intercept="0.41" />
          <feFuncB type="linear" slope="0.18" intercept="0.41" />
        </feComponentTransfer>
        <feBlend
          in="profileLensMap"
          in2="profileMicroRipple"
          mode="screen"
          result="profileStructuredLens"
        />
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
          result="profileRedChannel"
        />
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
          result="profileGreenChannel"
        />
        <feColorMatrix
          in="SourceGraphic"
          type="matrix"
          values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
          result="profileBlueChannel"
        />
        <feDisplacementMap
          in="profileRedChannel"
          in2="profileStructuredLens"
          scale={PROFILE_LENS_THICKNESS_SCALE + PROFILE_LENS_DISPERSION_SCALE}
          xChannelSelector="R"
          yChannelSelector="G"
          result="profileRedDispersion"
        />
        <feDisplacementMap
          in="profileGreenChannel"
          in2="profileStructuredLens"
          scale={PROFILE_LENS_THICKNESS_SCALE}
          xChannelSelector="R"
          yChannelSelector="G"
          result="profileGreenDispersion"
        />
        <feDisplacementMap
          in="profileBlueChannel"
          in2="profileStructuredLens"
          scale={PROFILE_LENS_THICKNESS_SCALE - PROFILE_LENS_DISPERSION_SCALE}
          xChannelSelector="R"
          yChannelSelector="G"
          result="profileBlueDispersion"
        />
        <feBlend
          in="profileRedDispersion"
          in2="profileGreenDispersion"
          mode="screen"
          result="profileRedGreenDispersion"
        />
        <feBlend
          in="profileRedGreenDispersion"
          in2="profileBlueDispersion"
          mode="screen"
          result="profileRgbCaustics"
        />
      </filter>
    </svg>
  );
}
