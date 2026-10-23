# CamNAS: free 24/7 camera recorder for Synology NAS (Surveillance Station alternative)

**English** | [Tiếng Việt](README.vi.md)

CamNAS is a free, self-hosted NVR that runs in Docker on your NAS. It records your IP cameras 24/7 straight to the NAS disks and gives you a web interface similar to Synology Surveillance Station, **without per-camera licenses**. Surveillance Station usually ships with only 2 free camera licenses; CamNAS records as many cameras as your NAS can handle.

> CamNAS is an independent project, not affiliated with, endorsed by or sponsored by Synology Inc. Synology, DSM, Surveillance Station and Package Center are trademarks of Synology Inc.; they are mentioned only to describe compatibility. See [Trademarks](#trademarks).

![Live view](docs/screenshots/live.jpg)

| Timeline playback | Camera management |
|---|---|
| ![Playback](docs/screenshots/playback.jpg) | ![Cameras](docs/screenshots/cameras.jpg) |

## Features

- **Live view**: camera grid (1, 1 large + 2 small, 2×2, 3×3) with about 1 second of latency. Quality switch **Auto / HD / SD**. Double-click a camera to enlarge it. Snapshot, full screen and audio.
- **Playback**: 24-hour timeline with one row per camera. Drag, zoom with the mouse wheel, click anywhere to play. Segments play back to back. Speed from 0.5× to 16×. Mark start and end to **export an mp4 clip**.
- **Share one camera by link**: anyone with the link watches that camera live without a CamNAS account. Optional password and expiry date; revoke a link at any time.
- **Cameras**: add, edit, delete, turn recording on or off, test the connection. Presets for EZVIZ/Hikvision, Imou/Dahua and TP-Link Tapo, or enter any RTSP URL.
- **Automatic cleanup**: delete recordings older than N days, or the oldest recordings when the disk is nearly full.
- **Choose the recordings folder** from the web interface, with a folder browser for the NAS.
- **Event log**: camera disconnects and reconnects, cleanup runs and failed sign-ins.
- Works on phones.
- **HTTPS out of the box** with the NAS's own certificate on port 8443, for safe remote viewing.
- **English / Tiếng Việt** interface: use the `VI | EN` switch in the top bar or on the sign-in screen.

How it works: [go2rtc](https://github.com/AlexxIT/go2rtc) keeps **one** RTSP connection per camera. `ffmpeg` copies the video stream as is (no re-encoding, so it uses almost no CPU) and cuts it into mp4 files aligned to the clock. The browser's live view uses the same connection.

```
<recordings folder>/<camera-id>/2026-10-21/14-35-00.mp4
```

The files are plain mp4, so you can open them with VLC or File Station without CamNAS.

## Requirements

- A Synology NAS with **Container Manager** (DSM 7.2 or later; most "+" models and some ARM64 models). The `.spk` package needs DSM 7.2.1 or later and installs **Web Station** with it (used for HTTPS). Any other NAS or Linux machine with Docker works too (use the docker-compose install).
- Cameras with **RTSP**. If a camera already worked with Surveillance Station, it has RTSP.
- A **fixed IP** for each camera: in the router or modem that gives the cameras their addresses, reserve an IP (DHCP reservation) for each camera's MAC address.

## Install as a Synology package (.spk) - recommended

Just like Surveillance Station: install it from Package Center, open it from the DSM main menu, and start, stop or update it in Package Center. Behind the scenes the package runs CamNAS in Container Manager.

Requirements: **DSM 7.2.1 or later** with **Container Manager** installed.

1. Download the latest `CamNAS-x.y.z-NNNN.spk` from [Releases](https://github.com/tvPhi/CamNAS/releases).
2. **Package Center → Settings → General → Trust Level** → choose **Any publisher**. The package is not signed by Synology, so Package Center refuses it otherwise.
3. **Package Center → Manual Install**, choose the `.spk` and follow the wizard. The first install downloads the CamNAS image, which takes about a minute.
4. Open **CamNAS** from the DSM main menu (or `http://NAS-IP:8090`), sign in with `admin` and change the password in *Settings*.

Good to know:
- Recordings go to the shared folder **camnas** that the package creates on volume1, the way Surveillance Station creates `surveillance`. The folder is kept if you uninstall. You can pick another folder in *Settings → Recordings folder*. The package runs as the DSM system user **CamNAS**, not root, so another shared folder first needs *Control Panel → Shared Folder → (folder) → Edit → Permissions → System internal user → CamNAS → Read/Write*.
- Camera settings and the event log live in the package's own folder and survive upgrades. Package Center can update CamNAS with one click, see [Updating](#updating-and-backup).
- The time zone follows the NAS.
- Can't reach GitHub's image registry from the NAS? Use the `-build-on-nas.spk` file instead: it builds the image on the NAS (a few minutes).
- The package uses port **8090** (HTTP). For HTTPS from outside, use the DSM reverse proxy (see [Remote access](#remote-access)). Stop any other CamNAS install first (see the next section).

### Moving from a docker-compose install to the package

1. In your current CamNAS, open *Settings → Backup & restore → Download backup*. On versions older than 1.4.0, download `data/config.json` from the project folder with File Station instead.
2. *Container Manager → Project → camnas → Stop*, then *Delete*. This removes the container only; your recordings stay where they are.
3. Install the package as above.
4. In the new CamNAS, open *Settings → Backup & restore → Restore from file…* and pick the backup. Your cameras, settings and password come back, and CamNAS keeps recording into your old recordings folder, so the timeline still shows everything. To move the recordings into the `camnas` share, choose it in *Settings → Recordings folder*; on the same volume the move is instant. If the backup came from a version older than 1.3.1 and your old recordings do not show up, choose your old recordings folder in *Settings → Recordings folder*.

## Install with Container Manager (docker-compose)

1. **Download the code** (*Code → Download ZIP* on GitHub, or `git clone`) and copy it to the NAS, for example to `/volume1/docker/camnas`, using File Station or an SMB share. The folder should look like this:
   ```
   camnas/
     docker-compose.yml
     app/   (Dockerfile, requirements.txt, nvr/...)
     data/  (settings - CamNAS writes here)
   ```
   **You do not need to create any folders yourself.**
2. **Container Manager → Project → Create**:
   - Project name: `camnas`
   - Path: `/volume1/docker/camnas`
   - Source: *Use existing docker-compose.yml*
   - Click *Next*, then *Done*. The first build takes a few minutes.
3. Open **http://NAS-IP:8090** and sign in with the password `admin`. Then **change the password** in *Settings*.
4. **Recordings folder**: on the first run, recordings go to `/volume1/docker/camnas/recordings`. To change it, open **Settings → Recordings folder** and click **Browse…** to pick a folder on the NAS, or type a path such as `/volume1/camera`.
   - Pick a folder inside a DSM **shared folder** so you can browse it in File Station.
   - When you switch to another folder on the same volume, existing recordings are moved there instantly.
   - Do not enable Snapshots on the recordings folder: snapshots keep deleted data, so disk space is never freed.
5. Open **Cameras → Add camera**, choose the brand and enter the IP, username and password. For **EZVIZ**, the username is `admin` and the password is the **verification code** (6 capital letters on the label under the camera). Click **Test connection**; if the resolution shows up, click **Add camera**. Recording starts within seconds.

   ![Add camera dialog with the EZVIZ preset](docs/screenshots/add-camera.jpg)

> If you used Surveillance Station before, stop it or remove the cameras from it once CamNAS works. Many cameras (EZVIZ in particular) limit the number of simultaneous RTSP streams, so two recorders connected at once can cause dropouts.

Set `TZ` in `docker-compose.yml` to your time zone (for example `Europe/Berlin` or `America/New_York`). The default is `Asia/Ho_Chi_Minh`.

### Install from the command line (SSH)

```bash
cd /volume1/docker/camnas && sudo docker compose up -d --build
```

### Disk access

To let you pick the recordings folder in the web interface, the container gets access to `/volume1`. CamNAS only writes to the folder you choose, and its automatic cleanup only touches camera folders it created itself (marked with a `.camnas` file). It never touches other data on the NAS.

- **Stricter access**: replace the `/volume1:/volume1` line in `docker-compose.yml` with one shared folder, for example `/volume1/camera:/volume1/camera`. You can then only pick folders inside it.
- **More than one volume**: uncomment the `/volume2:/volume2` line.

## RTSP addresses by brand

| Brand | Main stream | Sub stream |
|---|---|---|
| EZVIZ / Hikvision | `rtsp://admin:VERIFICATIONCODE@IP:554/h264/ch1/main/av_stream` | `.../h264/ch1/sub/av_stream` |
| Imou / Dahua | `rtsp://admin:PASSWORD@IP:554/cam/realmonitor?channel=1&subtype=0` | `...subtype=1` |
| TP-Link Tapo | `rtsp://USER:PASSWORD@IP:554/stream1` | `.../stream2` |

Choose the brand in the add-camera dialog and CamNAS builds these addresses for you.

**EZVIZ notes**:
- **Image/Video Encryption** must be **off** in the EZVIZ app; otherwise other software cannot decode the video.
- If *Test connection* says **"The camera refused the connection"**, RTSP may be off. To turn it on: connect your phone to the same Wi-Fi as the camera, open the EZVIZ app, go to *Profile → Settings → LAN Live View*, pick the camera, sign in with `admin` and the verification code, then open *Settings → Local Service Settings → RTSP*. Menu names vary a little between app versions.
- If the camera encodes **H.265**, CamNAS still records, but some browsers cannot play it (Firefox, or Chrome without hardware decoding). Switch the camera to **H.264** if that happens.
- Fill in the **sub stream**: small tiles in the grid use the lighter stream to save Wi-Fi bandwidth. Recording always uses the main stream.

## Storage

Rough estimate for 3 cameras:

| Camera resolution | Per camera/day | 3 cameras/day | 12 TB lasts |
|---|---|---|---|
| 1080p (~2 Mbps) | ~21 GB | ~65 GB | ~5–6 months |
| 2K/3MP (~3–4 Mbps) | ~35–45 GB | ~105–130 GB | ~3 months |

In **Settings** you can set:
- **Keep recordings for N days**: default 30. Use `0` to keep recordings until the disk is nearly full.
- **Maximum space for recordings**: useful if the disk also holds other data.
- **Always keep at least X GB free**: default 50 GB. When free space drops below this, the oldest files are deleted. Recordings from the last 24 hours are never deleted for lack of space.

Settings also shows the average space used per day and how many days the disk can hold.

## Remote access

**Do not** forward the plain-HTTP port 8090 to the internet. Safe options:
- **Package (.spk): Web Station.** The package does not run as root, so it cannot read the private key of the DSM certificate; DSM serves HTTPS instead and renews the certificate by itself. The package registers a **CamNAS** service in Web Station (installed with the package), WebSocket included.
  1. *Web Station → Web Portal → Create → Package service portal*, pick **CamNAS**, choose *Port-based* with HTTPS port **8443** (or *Name-based* with a host name of your own) and click *Create*. Pick the certificate in *Control Panel → Security → Certificate → Settings*.
  2. Forward TCP **8443** on your router to the NAS (on both routers if the NAS sits behind two) and remove any rule forwarding 8090.
  3. Enter `https://your-domain:8443` in *Settings → Remote access (HTTPS)*. Opening CamNAS at `http://your-domain:8090`, for example from the DSM main menu, then switches to HTTPS by itself.
  - Without Web Station: *Control Panel → Login Portal → Advanced → Reverse Proxy → Create* with source **HTTPS** port **8443**, destination **HTTP** `localhost` port **8090**, plus *Custom Header → Create → WebSocket*.
- **docker-compose: built-in HTTPS.** The container runs as root, so CamNAS also listens on port **8443** with the NAS's own certificate (for example from Let's Encrypt in *Control Panel → Security → Certificate*). Forward TCP **8443** to the NAS and open `https://your-domain:8443`. Pick another certificate in *Settings → HTTPS access*. When DSM renews the certificate, CamNAS loads the new one by itself.
- **Tailscale** (in Package Center): install it on the NAS and on your phone, then open `http://<NAS-Tailscale-IP>:8090`. No port forwarding at all.

## Sharing a camera

*Cameras* → share icon on a camera → *Create link*. Each link opens a live view of that one camera only (no playback, no other cameras, no settings), with an HD/SD switch.

- **Expires after**: the link stops working once that day is over (NAS time); tick *Never expires* to keep it.
- **Password** (optional, 4+ characters): the viewer types it once per browser; the session lasts up to 30 days or until the link expires.
- **Revoke**: the trash icon cuts off anyone watching right away. Deleting a camera also deletes its links.
- Links use the HTTPS address from *Settings → Remote access (HTTPS)* when it is set, so they work from outside your home network; otherwise they use the address you opened CamNAS with.
- Wrong link passwords are logged in the event log and lock that address out for a minute after 5 tries.

## Keyboard shortcuts

| Page | Keys |
|---|---|
| Live | `1`–`9`: enlarge that camera · `←`/`→`: next/previous camera · `Esc`: back to grid |
| Playback | `Space`: play/pause · `←`/`→`: back/forward 10 s (`Shift` for 1 min) · `PageUp`/`PageDown`: previous/next segment · `[` `]`: mark clip start/end · `+`/`-`: zoom timeline · `M`: mute |

## Updating and backup

- **docker-compose users**: download the new version and copy the `app/` folder over the old one. **Keep the `data/` folder.** Only copy `docker-compose.yml` when the new version changes it, and keep your own edits. In *Container Manager → Project → camnas*, click *Stop*, then *Action → Build*; clicking only *Start* keeps running the previously built version. Or run `docker compose up -d --build` again. *Settings → Updates* tells you when a new version is out. Afterwards press Ctrl+F5 in the browser and check the version in *Settings → System*.
- **Package users**: Package Center updates CamNAS like any other package. Set it up once: *Package Center → Settings → Package Sources → Add*, Name `CamNAS`, Location `http://127.0.0.1:8090/pkgsrc`. CamNAS checks for a new version every 6 hours (or right away with *Settings → Updates → Check now*) and shows a notice when a new version is out; Package Center then offers the **Update** button. Camera settings and recordings are kept. This needs CamNAS 1.4.0 or later, so install that version once with *Manual Install*. *Manual Install* with a newer `.spk` still works too.
- New versions are read from the public image package on ghcr.io, the same place the NAS downloads the image from, and CamNAS serves the `.spk` to Package Center itself (Package Center downloads it before stopping CamNAS for the upgrade). No GitHub account or token is needed. Tick *Include test versions* in *Settings → Updates* to also get pre-releases.
- **Backup**: *Settings → Backup & restore → Download backup* saves the camera list, settings and password in one file; *Restore from file…* brings them back on this or another NAS. With docker-compose, the `data/` folder holds `config.json` (camera list, **camera passwords**, chosen recordings folder) and the event log. Keep it safe and do not share it.

## Troubleshooting

- Check the **Logs** page first; every camera connection error is logged there.
- **The project does not start: `Bind mount failed: '/volume1/...' does not exist`**: you are using an old `docker-compose.yml`. Copy the current one; it only mounts the project folder and `/volume1`, which always exist.
- **Log says "The recordings folder ... cannot be used"**: pick another folder in *Settings → Recordings folder*.
- **"Cannot get video from the camera"**: check whether the camera IP changed, the password is right, and (for EZVIZ) image encryption is off. Use *Test connection* in the edit-camera dialog.
- **Playback stays black**: usually the camera uses H.265 (see the EZVIZ notes).
- **Live view does not work but recording does**: try a recent Chrome, Edge or Safari.
- **Cameras and NAS on different networks** (for example cameras on the ISP modem's Wi-Fi and the NAS behind a second router): the NAS can still reach the cameras, as long as the two networks use different address ranges.
- Container logs: *Container Manager → Container → camnas → Log*, or `sudo docker logs camnas`.

## Running locally (development)

You need Python 3.11+, `ffmpeg`/`ffprobe` and the `go2rtc` binary ([releases](https://github.com/AlexxIT/go2rtc/releases)).

```bash
cd app && pip install -r requirements.txt && DATA_DIR=./_data RECORDINGS_DIR=./_rec GO2RTC_BIN=/path/to/go2rtc python -m nvr
```

The app runs at http://localhost:8080. Other environment variables: `FFMPEG`, `FFPROBE`, `HTTP_PORT`, `ADMIN_PASSWORD`, and `STORAGE_ROOTS` (allowed root folders for recordings, separated by `:`, or `;` on Windows).

UI translations live in `app/nvr/web/i18n.js`; server-side messages in `app/nvr/i18n.py`.

## Releasing a new version (maintainers)

1. Bump `__version__` in `app/nvr/__init__.py` and commit.
2. Tag and push: `git tag v1.4.0 && git push origin v1.4.0`. A tag with a suffix such as `v1.4.0-rc1` becomes a pre-release.

GitHub Actions ([release.yml](.github/workflows/release.yml)) then builds the image `ghcr.io/tvphi/camnas` for amd64 and arm64 and attaches both `.spk` files to the GitHub release. The `.spk` files are also pushed to the same package as the tag `<version>-spk`, which is where CamNAS looks for updates. The container package must be **public** (*Package settings → Change visibility*); the repository itself may stay private. To build a package locally: `python spk/build.py` (builds on the NAS) or `python spk/build.py --image ghcr.io/tvphi/camnas` (uses the published image); the file lands in `dist/`.

## Credits and license

- [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT): receives the camera streams and serves live video to the browser. The CamNAS Docker image is built on the official go2rtc image.
- [FFmpeg](https://ffmpeg.org): recording and cutting the video files.
- CamNAS is released under the [MIT License](LICENSE).

### Trademarks

Synology, DSM, Surveillance Station, Package Center, Container Manager and Web Station are trademarks or registered trademarks of Synology Inc. EZVIZ and the other camera brands mentioned here are trademarks of their respective owners. CamNAS is an independent project and is not affiliated with, endorsed by or sponsored by any of them; their names are used only to describe compatibility. CamNAS contains no code, logos or images from Synology.
