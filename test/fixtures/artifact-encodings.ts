import { Buffer } from "node:buffer";

/** Noncanonical encodings that TypeScript may normalize while a byte-exact artifact check must reject. */
export const artifactEncodings = [
  {
    name: "UTF-8 BOM",
    encode: (text: string) =>
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]),
  },
  {
    name: "UTF-16 LE",
    encode: (text: string) =>
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
  },
  {
    name: "UTF-16 BE",
    encode: (text: string) =>
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]),
  },
  {
    name: "invalid UTF-8",
    encode: (text: string) => Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([0xff])]),
  },
] as const;
