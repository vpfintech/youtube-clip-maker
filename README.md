# YT Clip Maker

A free, source-available desktop app that uses bundled `yt-dlp` and `ffmpeg` to
fetch video locally and split it into fixed-length clips. Everything runs on your
own machine — no external APIs or accounts are required.

> **Responsible use:** This is a general-purpose tool. You are responsible for
> how you use it, including complying with the terms of service of any platform
> you access (such as YouTube) and with all applicable laws. See
> [Responsible Use & Disclaimer](#responsible-use--disclaimer) below before you
> begin.

## Features

- Paste one or more video URLs and click **Find videos**
- Preview each video in the right-side preview panel
- Open the selected video in your browser
- Save the selected video locally
- Generate clips at a custom interval (every X seconds)
- Toggle audio on/off for generated clips
- Choose an output folder
- Feather icons and skeleton loading UI

## Development

```bash
npm install
npm start
```

`npm install` downloads the correct `yt-dlp` binary into `bin/` for your platform.
`ffmpeg` is supplied by `@ffmpeg-installer/ffmpeg`.

## Checks

```bash
npm run check
npm run check:clip-args
bin/yt-dlp --version
```

## Build from source

YT Clip Maker is source-available, not open source. These build instructions are
for personal, educational, and non-commercial use under the [LICENSE](./LICENSE).

### macOS

Requirements:

- macOS
- Node.js LTS
- Git

Steps:

```bash
git clone https://github.com/vpfintech/youtube-clip-maker.git
cd youtube-clip-maker
npm install
npm run check
npm run check:clip-args
npm run dist:mac
```

The macOS build is created in `release/` as a DMG.

Notes:

- Unsigned macOS builds may require right-click → Open on first launch.
- Build macOS releases on macOS.

### Windows

Requirements:

- Windows 10 or newer
- Node.js LTS
- Git for Windows

Steps, from PowerShell:

```powershell
git clone https://github.com/vpfintech/youtube-clip-maker.git
cd youtube-clip-maker
npm install
npm run check
npm run check:clip-args
npm run dist:win
```

The Windows build is created in `release\` as a one-click NSIS installer.

Notes:

- Unsigned Windows builds may show a SmartScreen warning.
- Build Windows releases on Windows or CI. Cross-building Windows from Apple
  Silicon macOS can be blocked by Wine/electron-builder tooling.
- If `yt-dlp.exe` is missing after install, run `npm run fetch-binaries`, then
  run `npm run dist:win` again.

## Output folders

By default, files are saved under:

```text
~/YouTubeClipMakerDownloads/<project name>/<video id>/
```

Generated clips are saved under:

```text
<output folder>/<project name>/<video id>/clips/
```

The project name is required before downloading or generating clips so files stay
organized by project.

## Responsible Use & Disclaimer

This application is a general-purpose utility built on top of the third-party
tools `yt-dlp` and `ffmpeg`. The developer does not direct, encourage, or require
any particular use of it. How you use it is your decision and your
responsibility.

By using this software, you acknowledge that:

- **You are responsible for compliance.** You must ensure your use complies with
  all applicable laws and with the terms of service and acceptable-use policies
  of any third-party platform you access through the app, including YouTube.
  YouTube's Terms of Service govern your use of YouTube, and they restrict
  downloading content except where YouTube explicitly permits it.

- **You are responsible for rights.** You are responsible for having the
  necessary rights or permissions for any content you access, save, or process —
  for example, content you own, content you have created, content offered under a
  license that permits the use (such as Creative Commons), or content the rights
  holder has authorized you to use.

- **The software is provided "as is."** It comes with no warranty of any kind,
  and the developer is not liable for how it is used or for any consequences of
  that use. Full warranty disclaimers and limitation of liability are in the
  [LICENSE](./LICENSE).

- **Third-party services are not affiliated.** This project is not affiliated
  with, endorsed by, or sponsored by YouTube, Google, or any other platform.

If you are unsure whether a particular use is permitted, do not use the software
for that purpose until you have confirmed it is allowed.

## License

YT Clip Maker is **source-available** (not open source) and free for personal,
educational, and non-commercial use.

The source code is public so that users can inspect how the app works and verify
that it is safe. Commercial use, resale, paid redistribution, paid-product
integration, commercial-workflow use, and hosted/web/SaaS versions are not
permitted.

See [LICENSE](./LICENSE) for the full terms.

---

> 🔧 Looking for more **[YouTube automation tools](https://www.ytatools.co)**?
