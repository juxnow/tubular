# Tubular brand assets

Every export derives from the supplied 1449 x 916 PNG. The original is preserved byte for byte in `source/`. The artwork is never stretched, cropped, redrawn, or enlarged beyond its native resolution. Larger social canvases add space around the logo.

Download the complete [asset pack ZIP](tubular-brand-assets.zip). The [manifest](manifest.json) records dimensions and SHA-256 checksums.

| Directory   | Contents                                                                                                       | Use                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `source/`   | Original 1449 x 916 PNG                                                                                        | Master raster artwork                           |
| `logo/`     | PNG and lossless WebP, widths 160, 320, 480, 640, 800, 960, 1200, 1440                                         | README, docs, web headers, responsive images    |
| `icons/`    | Transparent squares, 16, 24, 32, 48, 64, 96, 128, 144, 152, 180, 192, 256, 384, 512, 1024                      | Avatars, icons, launchers                       |
| `favicons/` | 16/32/48 PNGs, multi-resolution ICO, 180 Apple touch icon, 192/512 web icons, 512 maskable icon, icon manifest | Browser and installable-web-app integration     |
| `desktop/`  | Multi-resolution Windows ICO, macOS ICNS and iconset, opaque 1024 PNG                                          | Desktop and app packaging                       |
| `social/`   | PNG/JPEG pairs: 1200 x 630, 1280 x 640, 1080 square, 1080 x 1350 portrait, 1080 x 1920 story                   | Link previews, repository preview, social posts |

Transparent variants retain the source alpha and add transparent padding for square canvases. Social images, the Apple touch icon, maskable icon, and opaque app icon use a warm cream background. The maskable variant keeps the whole artwork within the central safe circle. These exports preserve the full wordmark; a separate simplified symbol would be more legible at the smallest favicon sizes.

The original is raster artwork. No vector master or print-resolution detail is implied. The 1280 x 640 repository preview is ready to upload when desired; generation does not change repository settings.

## Web integration

Adjust paths for the application's public asset directory. The included web manifest declares icons only; application identity, start URL, scope, and display behavior belong to the host application.

```html
<link rel="icon" href="/assets/brand/favicons/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicons/favicon-32x32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/favicons/apple-touch-icon.png">
<link rel="manifest" href="/assets/brand/favicons/site.webmanifest">
```

## Regenerate

Generation uses the Homebrew-installed IconForge for the macOS ICNS export, macOS `sips` for resizing, the installed `cwebp` command, and `zip`. It does not add runtime dependencies or upload the artwork. Run from the repository root:

```sh
npm run assets:generate
```

The script replaces generated exports in this directory, verifies PNG dimensions and the unchanged source checksum, then rebuilds the ZIP. Update this guide before regeneration if the pack's contents change.
