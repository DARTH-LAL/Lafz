export default function Loading() {
  return (
    <main
      style={{
        position: "relative",
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#2a0d14",
      }}
    >
      {/* Dot grid */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          backgroundImage: "radial-gradient(rgba(255,20,100,0.14) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 20%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black 20%, transparent 100%)",
        }}
      />

      {/* Blob 1 — top-right */}
      <div style={{ position:"fixed", zIndex:1, pointerEvents:"none", borderRadius:"50%", width:720, height:720, top:-200, right:-180, background:"radial-gradient(circle, rgba(255,20,100,0.58) 0%, transparent 55%)", filter:"blur(52px)", animation:"lafz-drift1 13s ease-in-out infinite alternate" }} />
      {/* Blob 2 — bottom-left */}
      <div style={{ position:"fixed", zIndex:1, pointerEvents:"none", borderRadius:"50%", width:560, height:560, bottom:-130, left:-100, background:"radial-gradient(circle, rgba(230,10,70,0.50) 0%, transparent 55%)", filter:"blur(50px)", animation:"lafz-drift2 17s ease-in-out infinite alternate" }} />
      {/* Blob 3 — upper-left */}
      <div style={{ position:"fixed", zIndex:1, pointerEvents:"none", borderRadius:"50%", width:280, height:280, top:"12%", left:"8%", background:"radial-gradient(circle, rgba(255,40,100,0.36) 0%, transparent 60%)", filter:"blur(38px)", animation:"lafz-drift3 21s ease-in-out infinite alternate" }} />
      {/* Blob 4 — center-right */}
      <div style={{ position:"fixed", zIndex:1, pointerEvents:"none", borderRadius:"50%", width:420, height:320, top:"38%", right:"5%", background:"radial-gradient(ellipse, rgba(255,20,80,0.30) 0%, transparent 60%)", filter:"blur(44px)", animation:"lafz-drift4 19s ease-in-out infinite alternate" }} />
      {/* Blob 5 — lower-center */}
      <div style={{ position:"fixed", zIndex:1, pointerEvents:"none", borderRadius:"50%", width:240, height:240, bottom:"18%", left:"42%", background:"radial-gradient(circle, rgba(255,60,120,0.28) 0%, transparent 60%)", filter:"blur(36px)", animation:"lafz-drift5 25s ease-in-out infinite alternate" }} />

      {/* Wordmark */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          fontSize: 72,
          fontWeight: 900,
          letterSpacing: "-3px",
          fontFamily: "system-ui, sans-serif",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        <span className="lafz-l1">l</span>
        <span className="lafz-l2">a</span>
        <span className="lafz-l3">F</span>
        <span className="lafz-l4">z</span>
      </div>
    </main>
  );
}
