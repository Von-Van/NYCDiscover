import { ImageResponse } from "next/og";

export const alt = "NYC Discover: Plans, not lists";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f2ead8",
        color: "#161510",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "70px",
        width: "100%",
      }}
    >
      <div style={{ borderBottom: "10px solid #161510", borderTop: "28px solid #161510", display: "flex", flexDirection: "column", padding: "30px 0", width: "100%" }}>
        <div style={{ alignItems: "center", display: "flex", fontFamily: "sans-serif", fontSize: 94, fontWeight: 900, letterSpacing: "-7px" }}>
          <span style={{ background: "#d63227", color: "#faf5e9", marginRight: 18, padding: "2px 12px" }}>NYC</span> DISCOVER
        </div>
        <div style={{ display: "flex", fontFamily: "serif", fontSize: 78, lineHeight: 1, marginTop: 45 }}>A practical plan for right now.</div>
        <div style={{ color: "#d63227", display: "flex", fontFamily: "sans-serif", fontSize: 24, fontWeight: 800, letterSpacing: "5px", marginTop: 38 }}>PLANS, NOT LISTS</div>
      </div>
    </div>,
    size,
  );
}
