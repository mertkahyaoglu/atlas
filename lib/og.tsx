import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { DocGroup } from "./types";
import { getTag } from "./tags";

/**
 * The share card every link to this site renders as: Hacker News, Reddit,
 * Twitter, LinkedIn, Slack, Discord. It is the first impression of the atlas
 * far more often than the home page is, so it uses the same palette and the
 * same wordmark as the app rather than a generic template.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/** The dark theme's tokens, which is what a share card should look like. */
const COLOR = {
  canvas: "#101720",
  rule: "#253242",
  ink: "#d7dee8",
  inkMuted: "#8a97a8",
  inkFaint: "#64728a",
  concept: "#4fb8a8",
  design: "#e8a33d",
  tech: "#ad94f7",
  coding: "#6cb2ee",
} as const;

const ACCENT: Record<DocGroup, string> = {
  concept: COLOR.concept,
  design: COLOR.design,
  tech: COLOR.tech,
  coding: COLOR.coding,
};

const GROUP_LABEL: Record<DocGroup, string> = {
  concept: "Concept module",
  design: "Design",
  tech: "Key technology",
  coding: "Coding",
};

/**
 * Read from disk rather than fetched, so generating these images needs no
 * network and a CDN having a bad day cannot fail the build.
 */
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

function font(file: string): Buffer {
  return fs.readFileSync(path.join(FONT_DIR, file));
}

function fonts() {
  return [
    { name: "Plex Sans", data: font("IBMPlexSans-SemiBold.ttf"), weight: 600 as const, style: "normal" as const },
    { name: "Plex Mono", data: font("IBMPlexMono-Medium.ttf"), weight: 500 as const, style: "normal" as const },
  ];
}

/** The wordmark from the sidebar, in the same two tones. */
function Wordmark() {
  return (
    <div style={{ display: "flex", fontFamily: "Plex Mono", fontSize: 26 }}>
      <span style={{ color: COLOR.ink }}>atlas</span>
      <span style={{ color: COLOR.inkFaint }}>/</span>
      <span style={{ color: COLOR.concept }}>sysdesign</span>
    </div>
  );
}

/** Small mono pill, the card's equivalent of the tag chips on a document. */
function Chip({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: `1px solid ${COLOR.rule}`,
        borderRadius: 8,
        padding: "10px 16px",
        fontFamily: "Plex Mono",
        fontSize: 20,
        color: COLOR.inkMuted,
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      {label}
    </div>
  );
}

interface CardProps {
  /** The accent rule along the top, and the group marker when there is one. */
  accent: string;
  eyebrow?: string;
  title: string;
  body: string;
  chips: { label: string; color: string }[];
  footer: string;
}

function Card({ accent, eyebrow, title, body, chips, footer }: CardProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: COLOR.canvas,
        // A bar of the section's accent, which is how the app signals group.
        borderTop: `10px solid ${accent}`,
        padding: "64px 72px",
        fontFamily: "Plex Sans",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {eyebrow ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "Plex Mono",
              fontSize: 22,
              color: accent,
              marginBottom: 28,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} />
            {eyebrow}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            fontSize: titleSize(title),
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: COLOR.ink,
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 30,
            fontSize: 30,
            lineHeight: 1.4,
            color: COLOR.inkMuted,
          }}
        >
          {body}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 32 }}>
        {chips.map((chip) => (
          <Chip key={chip.label} label={chip.label} color={chip.color} />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `1px solid ${COLOR.rule}`,
          marginTop: 32,
          paddingTop: 28,
        }}
      >
        <Wordmark />
        <div style={{ display: "flex", fontFamily: "Plex Mono", fontSize: 22, color: COLOR.inkFaint }}>{footer}</div>
      </div>
    </div>
  );
}

/** Keeps a title to one or two lines; the longest here is 45 characters. */
function titleSize(title: string): number {
  if (title.length > 38) return 60;
  if (title.length > 26) return 72;
  return 84;
}

/**
 * Satori lays out one line at a time and will not break a long title politely,
 * so the text is trimmed to something that fits the card at its two sizes.
 */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function siteCard() {
  return new ImageResponse(
    (
      <Card
        accent={COLOR.concept}
        title="System Design Atlas"
        body="Concept modules, the technologies designs actually name, and worked designs with interactive architecture diagrams."
        chips={[
          { label: "Concepts", color: COLOR.concept },
          { label: "Key technologies", color: COLOR.tech },
          { label: "Designs", color: COLOR.design },
        ]}
        footer="atlas-sysdes.vercel.app"
      />
    ),
    { ...OG_SIZE, fonts: fonts() },
  );
}

export function docCard(doc: {
  title: string;
  summary: string;
  group: DocGroup;
  tags: string[];
  readingMinutes: number;
}) {
  const accent = ACCENT[doc.group];
  return new ImageResponse(
    (
      <Card
        accent={accent}
        eyebrow={GROUP_LABEL[doc.group]}
        title={clamp(doc.title, 70)}
        body={clamp(doc.summary, 165)}
        // Four is what fits on one row at this size without wrapping.
        chips={doc.tags.slice(0, 4).map((id) => ({ label: getTag(id).label, color: accent }))}
        footer={`${doc.readingMinutes} min read`}
      />
    ),
    { ...OG_SIZE, fonts: fonts() },
  );
}
