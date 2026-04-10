"use client";

// Fixed background with drifting neon pink blobs — intensity 3 (high)
// Drop inside any `relative` page wrapper. Blobs are pointer-events-none and fixed.

type AnimatedBackgroundProps = {
  lightweight?: boolean;
};

export function AnimatedBackground({ lightweight = false }: AnimatedBackgroundProps) {
  if (lightweight) {
    return (
      <>
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#2a0d14]" />
        <div
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{
            backgroundImage: "radial-gradient(rgba(255,20,100,0.08) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            opacity: 0.45,
          }}
        />
        <div
          className="pointer-events-none fixed inset-0 z-[1]"
          style={{
            background: "radial-gradient(circle at 50% 0%, rgba(255,20,100,0.18), transparent 50%)",
            opacity: 0.8,
          }}
        />
      </>
    );
  }

  return (
    <>
      {/* Base background colour */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[#2a0d14]" />

      {/* Dot grid */}
      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,20,100,0.14) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 20%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 20%, transparent 100%)",
        }}
      />

      {/* Blob 1 — large, top-right */}
      <div
        className="pointer-events-none fixed z-[1] rounded-full"
        style={{
          width: 720, height: 720,
          top: -200, right: -180,
          background: "radial-gradient(circle, rgba(255,20,100,0.58) 0%, transparent 55%)",
          filter: "blur(52px)",
          animation: "lafz-drift1 13s ease-in-out infinite alternate",
        }}
      />

      {/* Blob 2 — medium-large, bottom-left */}
      <div
        className="pointer-events-none fixed z-[1] rounded-full"
        style={{
          width: 560, height: 560,
          bottom: -130, left: -100,
          background: "radial-gradient(circle, rgba(230,10,70,0.50) 0%, transparent 55%)",
          filter: "blur(50px)",
          animation: "lafz-drift2 17s ease-in-out infinite alternate",
        }}
      />

      {/* Blob 3 — small, upper-left */}
      <div
        className="pointer-events-none fixed z-[1] rounded-full"
        style={{
          width: 280, height: 280,
          top: "12%", left: "8%",
          background: "radial-gradient(circle, rgba(255,40,100,0.36) 0%, transparent 60%)",
          filter: "blur(38px)",
          animation: "lafz-drift3 21s ease-in-out infinite alternate",
        }}
      />

      {/* Blob 4 — medium, center-right */}
      <div
        className="pointer-events-none fixed z-[1] rounded-full"
        style={{
          width: 420, height: 320,
          top: "38%", right: "5%",
          background: "radial-gradient(ellipse, rgba(255,20,80,0.30) 0%, transparent 60%)",
          filter: "blur(44px)",
          animation: "lafz-drift4 19s ease-in-out infinite alternate",
        }}
      />

      {/* Blob 5 — small, lower-center */}
      <div
        className="pointer-events-none fixed z-[1] rounded-full"
        style={{
          width: 240, height: 240,
          bottom: "18%", left: "42%",
          background: "radial-gradient(circle, rgba(255,60,120,0.28) 0%, transparent 60%)",
          filter: "blur(36px)",
          animation: "lafz-drift5 25s ease-in-out infinite alternate",
        }}
      />

      {/* Keyframes injected once */}
      <style>{`
        @keyframes lafz-drift1 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(-70px, 80px) scale(1.12); }
        }
        @keyframes lafz-drift2 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(80px, -70px) scale(1.18); }
        }
        @keyframes lafz-drift3 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(50px, 90px) scale(0.88); }
        }
        @keyframes lafz-drift4 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(-60px, -50px) scale(1.10); }
        }
        @keyframes lafz-drift5 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(70px, -60px) scale(1.15); }
        }
      `}</style>
    </>
  );
}
