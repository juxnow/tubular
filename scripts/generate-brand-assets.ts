import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** One generated image entry with dimensions and file-byte integrity data for the asset pack manifest. */
interface Asset {
  /** Pack-relative file location used by consumers and integrity verification. */
  readonly path: string;
  /** Raster width in pixels after generation. */
  readonly width: number;
  /** Raster height in pixels after generation. */
  readonly height: number;
  /** Encoded image format recorded in the manifest, such as png, jpeg, or webp. */
  readonly format: string;
  /** Lowercase SHA-256 hex digest of the exact encoded image bytes. */
  readonly sha256: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pack = path.join(root, "assets/brand");
const source = path.join(pack, "source/tubular-logo-1449x916.png");
const temporary = mkdtempSync(path.join(tmpdir(), "tubular-brand-"));
const assets: Asset[] = [];
const cream = "FFF6E9";

/** Run a local image or archive command and throw if it fails so partial generation cannot be reported as complete. */
function run(command: string, args: readonly string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

/** Hash the exact file bytes as lowercase SHA-256 hex for asset integrity checks. */
function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Record the generated file's pixel dimensions, format, and exact byte digest in the asset manifest. */
function record(relative: string, width: number, height: number, format: string): void {
  assets.push({ path: relative, width, height, format, sha256: digest(path.join(pack, relative)) });
}

/** Scale an image to the requested pixel width with sips, preserving its aspect ratio. */
function resize(input: string, output: string, width: number): void {
  run("sips", ["--resampleWidth", String(width), input, "--out", output]);
}

/** Center a scaled logo on the requested pixel canvas, with optional opaque background and bounded artwork fraction. */
function canvas(
  relative: string,
  width: number,
  height: number,
  opaque: boolean,
  fraction = 0.9,
): void {
  const contentWidth = Math.min(
    1449,
    Math.round(Math.min(width * fraction, (height * fraction * 1449) / 916)),
  );
  const output = path.join(pack, relative);
  resize(opaque ? path.join(temporary, "opaque.png") : source, output, contentWidth);
  run("sips", ["--padToHeightWidth", String(height), String(width), "--padColor", cream, output]);
  record(relative, width, height, "png");
}

/** Export a lossless WebP and record its file digest and pixel dimensions in the manifest. */
function webp(input: string, relative: string, width: number, height: number): void {
  run("cwebp", ["-quiet", "-lossless", "-exact", input, "-o", path.join(pack, relative)]);
  record(relative, width, height, "webp");
}

/** Package the requested square PNG frames in a Windows ICO container without re-encoding their pixels. */
function ico(relative: string, sizes: readonly number[]): void {
  const images = sizes.map((size) =>
    readFileSync(path.join(pack, `icons/tubular-icon-${size}.png`)),
  );
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const image = images[index];
    if (image === undefined) throw new Error("Missing icon frame");
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  writeFileSync(path.join(pack, relative), Buffer.concat([header, ...images]));
}

try {
  const originalDigest = digest(source);
  for (const directory of ["logo", "icons", "favicons", "social", "desktop/tubular.iconset"]) {
    mkdirSync(path.join(pack, directory), { recursive: true });
  }
  // Flatten only the variants that need an opaque background. The source and
  // transparent logo/icon variants keep their original alpha channel.
  run("cwebp", [
    "-quiet",
    "-lossless",
    "-blend_alpha",
    `0x${cream}`,
    source,
    "-o",
    path.join(temporary, "opaque.webp"),
  ]);
  run("sips", [
    "--setProperty",
    "format",
    "png",
    path.join(temporary, "opaque.webp"),
    "--out",
    path.join(temporary, "opaque.png"),
  ]);
  record("source/tubular-logo-1449x916.png", 1449, 916, "png");

  for (const width of [160, 320, 480, 640, 800, 960, 1200, 1440]) {
    const relative = `logo/tubular-logo-${width}.png`;
    resize(source, path.join(pack, relative), width);
    const dimensions = readFileSync(path.join(pack, relative));
    const height = dimensions.readUInt32BE(20);
    record(relative, width, height, "png");
    webp(path.join(pack, relative), `logo/tubular-logo-${width}.webp`, width, height);
  }
  for (const size of [16, 24, 32, 48, 64, 96, 128, 144, 152, 180, 192, 256, 384, 512, 1024]) {
    canvas(`icons/tubular-icon-${size}.png`, size, size, false);
  }
  for (const size of [16, 32, 48]) {
    const relative = `favicons/favicon-${size}x${size}.png`;
    copyFileSync(path.join(pack, `icons/tubular-icon-${size}.png`), path.join(pack, relative));
    record(relative, size, size, "png");
  }
  canvas("favicons/apple-touch-icon.png", 180, 180, true);
  for (const size of [192, 512])
    canvas(`favicons/android-chrome-${size}x${size}.png`, size, size, false);
  // A 64% width fits this rectangular artwork inside the maskable safe circle.
  canvas("favicons/maskable-icon-512.png", 512, 512, true, 0.64);
  ico("favicons/favicon.ico", [16, 32, 48]);
  ico("desktop/tubular.ico", [16, 32, 48, 64, 128, 256]);

  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const relative = `desktop/tubular.iconset/icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      copyFileSync(
        path.join(pack, `icons/tubular-icon-${size * scale}.png`),
        path.join(pack, relative),
      );
      record(relative, size * scale, size * scale, "png");
    }
  }
  run("iconforge", [
    "forge",
    path.join(pack, "icons/tubular-icon-1024.png"),
    "tubular",
    "--output",
    path.join(pack, "desktop"),
    "--force",
  ]);
  canvas("desktop/app-icon-1024.png", 1024, 1024, true);

  for (const [name, width, height] of [
    ["open-graph", 1200, 630],
    ["repository-preview", 1280, 640],
    ["square", 1080, 1080],
    ["portrait", 1080, 1350],
    ["story", 1080, 1920],
  ] as const) {
    const relative = `social/tubular-${name}-${width}x${height}.png`;
    canvas(relative, width, height, true, 0.86);
    const jpeg = relative.replace(/\.png$/, ".jpg");
    run("sips", [
      "--setProperty",
      "format",
      "jpeg",
      "--setProperty",
      "formatOptions",
      "90",
      path.join(pack, relative),
      "--out",
      path.join(pack, jpeg),
    ]);
    record(jpeg, width, height, "jpeg");
  }

  writeFileSync(
    path.join(pack, "favicons/site.webmanifest"),
    `${JSON.stringify(
      {
        name: "Tubular",
        short_name: "Tubular",
        icons: [
          {
            src: "android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "maskable-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  for (const asset of assets) {
    if (asset.format !== "png") continue;
    const data = readFileSync(path.join(pack, asset.path));
    if (data.readUInt32BE(16) !== asset.width || data.readUInt32BE(20) !== asset.height) {
      throw new Error(`Unexpected dimensions: ${asset.path}`);
    }
  }
  if (digest(source) !== originalDigest) throw new Error("Source logo changed during generation");
  writeFileSync(
    path.join(pack, "manifest.json"),
    `${JSON.stringify(
      {
        source: "source/tubular-logo-1449x916.png",
        sourceSha256: originalDigest,
        background: `#${cream}`,
        assets,
        containers: ["favicons/favicon.ico", "desktop/tubular.ico", "desktop/tubular.icns"].map(
          (file) => ({ path: file, sha256: digest(path.join(pack, file)) }),
        ),
      },
      null,
      2,
    )}\n`,
  );
  const archive = path.join(temporary, "tubular-brand-assets.zip");
  run(
    "zip",
    [
      "-q",
      "-X",
      "-r",
      archive,
      "README.md",
      "manifest.json",
      "source",
      "logo",
      "icons",
      "favicons",
      "social",
      "desktop",
    ],
    pack,
  );
  copyFileSync(archive, path.join(pack, "tubular-brand-assets.zip"));
  process.stdout.write(
    `Generated and verified ${assets.length} images, 3 icon containers, an icon manifest, and the asset-pack ZIP.\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
