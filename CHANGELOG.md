# Changelog

All notable changes to FreeRec are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

To cut a release: bump `version` in `manifest.json`, add a section below, then
push a matching tag (`git tag v1.2.0 && git push origin v1.2.0`). The
[Release workflow](.github/workflows/release.yml) builds the zip and publishes
it with the notes from this file.

## [Unreleased]

### Changed
- Release workflow uses `actions/checkout@v7` and `actions/setup-node@v7` (Node 24)
  and also validates and builds every pull request.

## [1.1.0] - 2026-10-20

### Added
- **In-page control panel** that replaces the toolbar popup. It has Home,
  Video/Screenshot switcher, recording source (Full Screen, Window, Current
  tab, Camera only), camera and microphone rows with On/Off toggles, Start
  Recording, and Effects / Blur / Folder / More.
- **Current tab** recording through `chrome.tabCapture`, with no share picker
  when the panel is opened from the toolbar icon.
- **Vertical control bar** while recording: finish, timer, pause/resume,
  restart (with a new countdown), discard and camera toggle.
- **Redesigned 3 · 2 · 1 countdown** with a progress ring. `Esc` cancels it.
- **Camera effects:**
  - background blur and virtual backgrounds (scenes, colours, your own
    image), powered by the on-device MediaPipe Selfie Segmenter
  - 10 colour filters with live previews
- **Canvas page** with:
  - background colours plus a custom colour picker
  - six image backgrounds
  - six text layouts
  - six templates (Meeting, Standup, Celebration, News, Intro, Bubble) that
    also position the camera bubble
- **Screenshots** of a custom area or the current tab, saved as PNG.
- **Library redesign:** Videos/Screenshots tabs, search, sorting, duration
  badges and a viewer.
- Panel dark mode, plus quality and format options on the Settings page.
- MIT `LICENSE`, full README, and an automated GitHub Release workflow.

### Changed
- The recorder tab now stays in the background and only comes forward when it
  needs a click or Chrome's share picker.
- Clicking the icon on pages that can't host the panel (`chrome://`, Web
  Store) opens the Canvas page.

## [1.0.0] - 2026-10-20

### Added
- First release: screen, window and tab recording through
  `chrome.desktopCapture`, an on-page camera bubble, microphone and system
  audio mixing, pause/resume, discard and a 3-2-1 countdown.
- Recordings stream straight into a folder you choose (File System Access
  API), or into `Downloads/FreeRec` as a fallback.
- WebM duration patching so recordings show their length and can seek.
- Recordings library, setup page and keyboard shortcuts.

[Unreleased]: https://github.com/kowshik24/freerec/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/kowshik24/freerec/releases/tag/v1.1.0
[1.0.0]: https://github.com/kowshik24/freerec/commits/main
