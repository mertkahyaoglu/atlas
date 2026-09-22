import { ImageResponse } from "next/og";

/** The wordmark's slash, in the concept teal, on the app's canvas. */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#101720",
          color: "#4fb8a8",
          fontSize: 26,
          fontWeight: 700,
        }}
      >
        /
      </div>
    ),
    size,
  );
}
