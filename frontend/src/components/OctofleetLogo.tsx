"use client";

export function OctofleetLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 32 32" 
      width={size} 
      height={size}
      className={className}
      style={{ imageRendering: "pixelated" }}
    >
      {/* Octopus Body (purple/magenta) */}
      <rect x="12" y="4" width="8" height="2" fill="#9333ea"/>
      <rect x="10" y="6" width="12" height="2" fill="#9333ea"/>
      <rect x="9" y="8" width="14" height="4" fill="#9333ea"/>
      <rect x="10" y="12" width="12" height="2" fill="#9333ea"/>
      
      {/* Eyes */}
      <rect x="11" y="9" width="2" height="2" fill="#ffffff"/>
      <rect x="19" y="9" width="2" height="2" fill="#ffffff"/>
      <rect x="12" y="10" width="1" height="1" fill="#000000"/>
      <rect x="20" y="10" width="1" height="1" fill="#000000"/>
      
      {/* Tentacles */}
      <rect x="8" y="14" width="2" height="4" fill="#a855f7"/>
      <rect x="6" y="18" width="2" height="4" fill="#a855f7"/>
      <rect x="5" y="22" width="2" height="4" fill="#a855f7"/>
      
      <rect x="11" y="14" width="2" height="4" fill="#a855f7"/>
      <rect x="10" y="18" width="2" height="4" fill="#a855f7"/>
      <rect x="9" y="22" width="2" height="4" fill="#a855f7"/>
      
      <rect x="14" y="14" width="4" height="4" fill="#a855f7"/>
      <rect x="14" y="18" width="4" height="4" fill="#a855f7"/>
      <rect x="14" y="22" width="4" height="6" fill="#a855f7"/>
      
      <rect x="19" y="14" width="2" height="4" fill="#a855f7"/>
      <rect x="20" y="18" width="2" height="4" fill="#a855f7"/>
      <rect x="21" y="22" width="2" height="4" fill="#a855f7"/>
      
      <rect x="22" y="14" width="2" height="4" fill="#a855f7"/>
      <rect x="24" y="18" width="2" height="4" fill="#a855f7"/>
      <rect x="25" y="22" width="2" height="4" fill="#a855f7"/>
    </svg>
  );
}
