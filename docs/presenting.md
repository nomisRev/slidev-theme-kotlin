# Presenting from your phone

`slidev-kotlin-present` serves a built deck on your local network and turns
your phone into the clicker. It needs no internet connection.

## Start a talk

```bash
slidev build
npx slidev-kotlin-present
```

```
Display  http://localhost:4174/

Remote   http://192.168.0.121:4174/?k=…  (en0)

  █▀▀▀▀▀█ ▄█  ▄▄▀█▀ ▄▀  █▀▀▀▀▀█
  █ ███ █ ▄█▀   █▄▄▄▄ █ █ ███ █
  …
```

1. Open the **Display** link in a browser on the laptop and put that window
   on the projector.
2. Scan the QR code with the phone. It opens the remote on the slide the talk
   is on.
3. Tap the right half of the screen to advance, the left half to go back.

The laptop and the phone must be on the same network, and that network must
let them talk to each other. Conference Wi-Fi often does not: connect the
laptop to your phone's hotspot instead, then start the command again so the
code carries the new address.

## What the phone shows

| Part | What it is |
| --- | --- |
| Top | What the next tap reveals: the next click of this slide, or the next slide |
| Counter | The current slide and the number of slides |
| Notes | The speaker notes of the current slide |
| Status line | `Connected · 1 display`, or what is wrong |

The status line tells you what to do when something is off:

| Status | Meaning |
| --- | --- |
| `Connected · 1 display` | Taps move the display |
| `No display connected` | Open, or reload, the Display link on the laptop |
| `Reconnecting…` | The phone lost the server; it retries every second |
| `View only` | The page was not opened from the QR code, so it cannot move the slides |
| `This remote link has expired` | The secret was replaced; scan the code again |

The phone stays awake from your first tap on. Stepping back onto a slide with
reveals lands on its last click, as the keyboard does.

## Laptop presenter view

On a laptop, `/presenter/1` is still Slidev's presenter console with its
timer, overview, and keyboard shortcuts. Phones and tablets get the remote.
A laptop that opens the remote link drives the displays from the console.

The remote sends and displays follow. A key pressed on the display moves that
display alone, until the next tap.

## Who can move the slides

The remote link ends in `?k=<secret>`. Only a page opened from that link can
move the slides. Everybody else on the network can open the deck and read it,
speaker notes included, but not drive it.

- The secret is saved in `node_modules/.cache/slidev-kotlin-present/secret`,
  so the phone stays connected when you restart the command.
- `--new-secret` replaces it. Every link printed before stops working.
- The link travels over plain HTTP. On an open Wi-Fi somebody could capture
  it, so present over a hotspot or a network with a password.

## Options

```bash
slidev-kotlin-present [dist] [--port 4174] [--new-secret]
```

| Option | Default | What it does |
| --- | --- | --- |
| `dist` | `./dist` | The built deck to serve |
| `--port`, `-p`, or `PORT` | `4174` | The port to listen on |
| `--new-secret` | – | Replace the saved secret |

A deck built for GitHub Pages (`--base /my-deck/ --router-mode hash`)
presents as it is. After another `slidev build`, reload the display and the
phone; the command keeps running.

Add it to your `package.json` to start a talk with `npm run present`:

```json
{
  "scripts": {
    "present": "slidev build && slidev-kotlin-present"
  }
}
```

## Colours

The remote follows the deck's light or dark scheme. Override its colours from
your stylesheet:

```css
.remote-control {
  --remote-control-color: #1d1d1d;
  --remote-control-muted-color: #666;
  --remote-control-background: #f9fafb;
  --remote-control-preview-background: #fff;
  --remote-control-edge-color: #c9c9c9;
}
```

## While writing

`slidev --remote` serves the same remote from the development server, without
the command above: open `/presenter/1` on the phone. There, the display and
the phone follow each other in both directions.
