# FreeRec – free screen & camera recorder for Chrome

Record your screen, a window or a tab with a camera bubble, background effects
and filters, or take screenshots. Files are saved **straight into a folder you
choose**. You don't need an account or a plan, and nothing is uploaded.

## Install (no Web Store needed)

1. Download `freerec-1.1.0.zip` and unzip it. You get a `freerec` folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right switch).
4. Click **Load unpacked** and select the unzipped `freerec` folder.
5. A setup page opens. Click **Allow camera & microphone**, then **Choose folder…**
   to pick where recordings are saved.
6. Pin FreeRec from the puzzle-piece menu so the icon stays in the toolbar.

Don't delete or move the unzipped folder after installing. Chrome loads the
extension from it.

## Record

1. Click the FreeRec icon (or press `Alt+Shift+O`). A control panel opens on
   the page:
   - **Full Screen / Window / Current tab / Camera only:** what to record.
   - **Camera** and **Microphone** rows: pick a device, or tap the On/Off pill.
   - **Effects:** background blur, virtual backgrounds (scenes, colors, your
     own image), 10 colour filters, and **Canvas** templates to present on.
   - **Blur:** quick background-blur toggle.
   - **Folder:** where files are saved. **More:** settings, recordings,
     help, dark mode.
2. Click **Start Recording**. Pick what to share if Chrome asks. **Current tab**
   needs no picker when you opened the panel from the toolbar icon.
3. A **3 · 2 · 1** countdown runs. Press `Esc` to cancel it.
4. The control bar on the left has **■ finish**, timer, **pause**, **restart**,
   **discard** and **camera on/off**. Drag the bar or the bubble anywhere.
   The bubble's resize button cycles its size.
5. Finish. The video is in your folder and **My recordings** opens to play it.

## Canvas

Effects → **Canvas** (or the Canvas icon in the library) opens a slide-like
page to present on. The toolbar at the bottom has:

- **Background:** colour swatches, a custom colour (+), and six background
  images (Pastel, Rainbow, Paint, Lagoon, Dashes, Floral).
- **Text layout:** Blank, Say hello, Big idea (top or left), Bullet points,
  Pros and cons. Click any text on the page to edit it.
- **Templates:** Meeting, Standup, Celebration, News, Intro, Bubble. Each one
  also moves your camera bubble into place.

The toolbar hides itself while you record.

## Screenshots

Click the camera icon at the top of the panel, then choose **Custom area**
(drag to select) or **Current tab**. Screenshots go to the same folder.

## Shortcuts

| Shortcut      | Action                  |
|---------------|-------------------------|
| `Alt+Shift+O` | Open the panel          |
| `Alt+Shift+X` | Finish & save           |
| `Alt+Shift+P` | Pause / resume          |
| `Alt+Shift+C` | Discard recording       |

You can change these at `chrome://extensions/shortcuts`.

## Where files go

- **Chosen folder:** the video is written into it as you record, named like
  `FreeRec 2026-10-20 at 14.05.33.webm`. Screenshots are named
  `Screenshot … .png`.
- **No folder chosen:** files go to `Downloads/FreeRec/`.
- Quality (720p to 4K) and format (WebM or MP4) are in **More → Settings**.

## How it works

- `panel.html` is the control panel. `content.js` puts it on the page in an
  iframe, along with the camera bubble (`camera.html`), the control bar,
  the countdown and the screenshot area picker.
- `recorder.html` is a pinned tab that does the capture (`chrome.tabCapture`
  for the current tab, `chrome.desktopCapture` for screen/window) and runs
  `MediaRecorder`. It streams the file to disk and writes the WebM duration
  when you finish.
- `lib/effects.js` draws the bubble with filters and backgrounds. Person
  segmentation uses MediaPipe's selfie segmenter (Apache-2.0, bundled in
  `vendor/mediapipe`, runs fully offline).
- `canvas.html` is a slide-like page with backgrounds, text layouts and
  templates to record on.

## Limits

- Effects apply to the camera bubble. **Camera only** recordings are the
  plain camera.
- The panel and bubble can't show on `chrome://` pages or the Web Store.
  Clicking the icon there opens the Canvas page instead.
- On macOS, full-screen recordings can't capture system audio (a Chrome
  limit). Tab audio works.
- Keep the pinned recorder tab open while recording.
