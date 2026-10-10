import { ImageResponse } from "next/og";

// Static social card: rendered once at build time from text only. No
// external fetches, no live data and no custom fonts (Next's bundled default).
export const alt = "Brief Command: prediction markets, forecasting and community";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(circle at 85% 15%, rgba(18,214,245,0.18), rgba(5,9,20,0) 45%), #050914",
          color: "#e8edf6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, letterSpacing: 4, fontWeight: 600 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: "#12d6f5" }} />
          BRIEF COMMAND
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
          <span>Read the market.</span>
          <span style={{ color: "#9fe9f7" }}>Test your thesis.</span>
          <span style={{ color: "#8f9bb3" }}>Bring others in.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#8f9bb3" }}>
          <span>Prediction markets · Free forecasting · Community</span>
          <span>Powered by Panta API · Solana</span>
        </div>
      </div>
    ),
    size,
  );
}
