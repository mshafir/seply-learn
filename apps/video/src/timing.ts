// The storyboard's clock (spec 9.3, issue #121): seven scenes over 60 s at
// 30 fps, and the captions burned into the video and written to explainer.vtt.
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

const s = (seconds: number) => Math.round(seconds * FPS);

/** Each scene's first frame and length, in frames. */
export const SCENES = {
  question: { from: s(0), duration: s(7) },
  sources: { from: s(7), duration: s(6) },
  concepts: { from: s(13), duration: s(11) },
  views: { from: s(24), duration: s(14) },
  suggestions: { from: s(38), duration: s(10) },
  together: { from: s(48), duration: s(7) },
  end: { from: s(55), duration: s(5) },
} as const;

export const DURATION = s(60);

/** The 12 s hero loop: from Concepts appearing into the first Views. */
export const HERO = { from: s(14), duration: s(12) };

/** The poster frame: every Concept drawn, before the View switch. */
export const POSTER_FRAME = s(23);

export type Caption = { start: number; end: number; text: string };

/** Captions in seconds, verbatim from the storyboard. The end card has none. */
export const CAPTIONS: Caption[] = [
  { start: 0.5, end: 6.8, text: "Start with a question, in Seply Learn or from your own AI agent." },
  { start: 7.2, end: 12.8, text: "If you already have chats, notes or links on the subject, you can add them too." },
  { start: 13.2, end: 23.8, text: "Seply Learn works out the ideas involved and how they connect, and notes where each one came from." },
  {
    start: 24.2,
    end: 37.8,
    text: "You can read the result as a learning path, a comparison, a timeline or a map. Each View is laid out automatically.",
  },
  { start: 38.2, end: 47.8, text: "Agents can suggest additions. Each one stays a suggestion until you accept it." },
  { start: 48.2, end: 54.8, text: "You can share an Expedition and work on it with other people at the same time." },
];

const stamp = (t: number) => {
  const ms = Math.round(t * 1000);
  const hh = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
  const ss = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, "0")}`;
};

/** The captions as a WebVTT file. */
export function toWebVtt(captions: Caption[] = CAPTIONS): string {
  return ["WEBVTT", ...captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`)].join("\n\n") + "\n";
}
