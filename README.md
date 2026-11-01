# VideoFlex

VideoFlex is a lightweight Manifest V3 browser extension for adjusting HTML5 video playback. It adds an on-video control panel for visual adjustments, playback speed, volume boost, equalization, and HRTF-based spatial audio.

## Features

- Resize video without changing its aspect ratio.
- Adjust brightness, contrast, saturation, and sepia.
- Set playback speed from 0.1x to 5x.
- Temporarily switch to 2x speed by holding Space or by clicking and holding directly on the video.
- Boost audio up to 300% and use equalizer presets or custom bass, mid, and treble levels.
- Enable Ambient mode to blend in a virtual sound positioned behind the listener. Headphones are recommended; the effect varies with the browser and listener.
- Save settings separately for each site and reset the current site's settings from the extension popup.

## Install

VideoFlex is not currently packaged in a browser store. To load it locally in Chrome or Microsoft Edge:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder containing `manifest.json`.
5. Open a page with an HTML5 video and hover over the video to show the VideoFlex control button.

## Use

Select the on-video control button to open the controls. The extension popup also lets you enable or disable VideoFlex globally and reset settings for the current site.

| Shortcut                                     | Action                                    |
| -------------------------------------------- | ----------------------------------------- |
| Hold `Space`                                 | Temporarily use 2x speed                  |
| Hold left mouse button directly on the video | Temporarily use 2x speed                  |
| `Alt` + `V`                                  | Toggle the on-video menu                  |
| `]` / `[`                                    | Increase / decrease scale by 5%           |
| `\`                                          | Reset scale to 100%                       |
| `Shift` + `}` / `Shift` + `{`                | Increase / decrease speed by 0.1x         |
| `Alt` + `B`                                  | Reset controls for the current video/site |

The temporary 2x boost activates after the hold has lasted about one second. Shortcuts are ignored while focus is in a text input or editable area.

## Audio notes

Equalizer, volume boost, and Ambient mode use the Web Audio API. Some sites or media sources restrict audio processing, including certain DRM-protected or cross-origin videos. In those cases, audio controls may be unavailable even though visual controls still work. Ambient mode uses generic HRTF spatialization rather than personalized ear measurements or head tracking, so the perceived front/back position varies by listener and playback device.

## Permissions and privacy

- **Storage**: saves the global enabled setting and per-site control settings locally using `chrome.storage.local`.
- **Active tab**: lets the popup communicate with the current tab.
- **Site access (`<all_urls>`)**: the content script runs in matching frames so it can find and control HTML5 videos on websites. The extension needs broad site access to work across sites.

The source in this repository contains no analytics or code that sends browsing or settings data to a remote server. Video controls and settings are handled locally in the browser.

## Project files

- `manifest.json` - Manifest V3 configuration and permissions.
- `content.js` - Video discovery, controls, and audio processing.
- `popup.html` and `popup.js` - Extension popup and its actions.
- `icon.png` - Extension icon.
