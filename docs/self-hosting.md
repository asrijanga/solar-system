# Self-hosting the full-detail Moon

The website shows the Moon at the detail that fits on GitHub Pages. `npm run local` shows all of it: every tile built on demand from NASA's and JAXA's own files (docs/stories/SS-10c.md), with the labelled approximation below the finest measurement (docs/stories/SS-10b.md). The Docker image runs that same server on any always-on machine, such as a NAS, for free.

## Run it

```sh
git clone https://github.com/asrijanga/solar-system.git
cd solar-system
docker compose up -d
```

Then open `http://localhost:5178/` on that machine. Or, without Compose:

```sh
docker build -t solar-system .
docker run -d --restart unless-stopped -p 5178:5178 -v moon-cache:/data --name solar-system solar-system
```

- **Image:** about 340 MB. It runs as an unprivileged user and needs no npm packages at run time.
- **Machine types:** amd64 or arm64 (the `node:22-slim` base).
- **Memory:** 1 GB is comfortable.

## The cache grows as you explore

Everything downloaded or built goes to `/data` (`./moon-cache` with Compose), so each place is fetched only once.

- **Each 3° × 3° area first visited closely** adds its Kaguya file, 233 MB. The whole Moon would be about 1.1 TB.
- **The LOLA and SLDEM2015 blocks** add a few MB per area.
- **Built tiles** are about 80 KB each.

Put the volume on a disk with room. Deleting it only means things are fetched again.

The first close visit to a new area takes about 20–60 s, while that area's Kaguya file downloads. After that, tiles come from the cache.

## Using it from a phone or another computer: https

Browsers only allow WebGPU on secure pages. `http://localhost` counts, but `http://192.168.x.x:5178` from another device does not: the app will say WebGPU is unavailable. Put the server behind https in one of these ways.

**Tailscale (free for personal use, private to your devices).** Install Tailscale on the NAS and on your phone, then on the NAS run:

```sh
tailscale serve --bg 5178
```

Open the `https://<nas-name>.<tailnet>.ts.net/` address it prints, on any of your devices. The certificate is a real one, so nothing needs trusting by hand. If your Tailscale version's syntax differs, `tailscale serve --help` shows it.

**Your NAS's reverse proxy.** Synology, QNAP and others have one, with free Let's Encrypt certificates. Point an https host name at `http://localhost:5178`. This makes it reachable from the internet. The server downloads from NASA and JAXA on demand and caches without limit, so anyone who finds it could fill your disk. Prefer Tailscale unless you want it public.

## Settings

| Variable | Default in the image | Meaning |
| --- | --- | --- |
| `PORT` | `5178` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on (outside Docker the default is `127.0.0.1`, this machine only) |
| `MOON_CACHE` | `/data` | Where downloads and tiles are cached |

## Updating

```sh
git pull
docker compose up -d --build
```

The cache is kept. Tiles built by an older version stay as they were; delete `moon-cache/tiles*` to rebuild them.
