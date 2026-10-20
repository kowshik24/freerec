# FreeRec – free screen & camera recorder for Chrome

Record your screen, a window or a tab, with a camera bubble and microphone, and
the video is saved **straight into a folder you choose**. You don't need an
account or a plan, and nothing is uploaded.

## Install (no Web Store needed)

1. Download `freerec-1.0.0.zip` and unzip it. You get a `freerec` folder.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right switch).
4. Click **Load unpacked** and select the unzipped `freerec` folder.
5. A setup page opens. Click **Allow camera & microphone**, then **Choose folder…**
   to pick where recordings are saved.
6. Pin FreeRec from the puzzle-piece menu so the icon stays in the toolbar.

Don't delete or move the unzipped folder after installing. Chrome loads the
extension from it.

## Record

1. Click the FreeRec icon (or press `Alt+Shift+O`).
2. Pick **Screen + Cam**, **Screen only**, or **Cam only**, then the camera, mic,
   quality and format (WebM or MP4).
3. Click **Start recording** and choose a screen, window or tab in Chrome's
   dialog. Tick **Share audio** to record that tab's or system sound.
4. After a 3-2-1 countdown, recording starts. A control bar and a draggable
   camera bubble appear on the page.
5. Click the red ■ (or press `Alt+Shift+X`) to finish. The file is already in
   your folder, and **My recordings** opens to play it.

| Shortcut      | Action                    |
|---------------|---------------------------|
| `Alt+Shift+O` | Open FreeRec              |
| `Alt+Shift+X` | Finish & save             |
| `Alt+Shift+P` | Pause / resume            |
| `Alt+Shift+C` | Discard recording         |

You can change these at `chrome://extensions/shortcuts`.

## Where files go

- **Chosen folder:** the video is written into it as you record, named like
  `FreeRec 2026-10-20 at 14.05.33.webm`. If Chrome has forgotten the folder
  permission, the recorder tab asks you to confirm with one click.
- **No folder chosen:** the video is saved to `Downloads/FreeRec/`.

## How it works

- `recorder.html` is a pinned tab that does the capture (`chrome.desktopCapture`
  plus `MediaRecorder`). It mixes the mic and tab/system audio, and streams
  1-second chunks to disk with the File System Access API.
- WebM files get a real duration written into their header, so players show
  the length and can seek.
- `content.js` adds the camera bubble (`camera.html` in an iframe) and the
  control bar to the page you're on. Because the bubble is part of the page,
  it shows up in the recording.
- `background.js` is the service worker. It opens the recorder tab, relays
  shortcuts, updates the toolbar badge and adds the overlay to each tab you
  switch to.

## Limits

- The camera bubble only shows on normal web pages. Chrome doesn't allow it on
  `chrome://` pages or the Web Store. To get your face in a recording of
  another app's window or the whole screen, keep a Chrome tab with the bubble
  visible on screen.
- Some sites block cameras in embedded frames, so the bubble shows
  "Camera blocked on this page".
- On macOS, whole-screen recordings can't capture system audio (a Chrome
  limit). Tab audio works.
- Keep the pinned recorder tab open while recording.
