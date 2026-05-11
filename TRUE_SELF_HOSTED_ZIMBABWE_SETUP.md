# True Self-Hosted Zimbabwe Map Setup

This guide shows how to run a fully self-hosted Zimbabwe map stack for `TrustCars` using:

- `OpenStreetMap` data for Zimbabwe
- `OSRM` for routing
- `Nominatim` for geocoding and place search
- `MapLibre` in the app/admin for rendering
- optional self-hosted tiles later

This removes vendor map billing. You use your own server and your own OSM data.

## What Is Free

These are free and open source:

- `OpenStreetMap` data
- `OSRM`
- `Nominatim`
- `MapLibre`
- tile server software

What is not free:

- your server CPU/RAM/storage
- bandwidth
- backups
- maintenance time

## Recommended Rollout

Do this in phases:

1. Set up `OSRM`
2. Set up `Nominatim`
3. Point the app/backend to your own endpoints
4. Add self-hosted tiles if you want complete control

This is the safest path because routing and search matter more to the ride flow than tiles.

## Suggested Server Size

For `Zimbabwe only`, a reasonable starting point is:

- `4 vCPU`
- `8 GB RAM` minimum
- `16 GB RAM` is more comfortable if running `Nominatim`
- `100+ GB SSD`

If you want `OSRM + Nominatim + tiles` on one machine, more RAM is better.

## Low-Memory Warning

If you try to do this on a very small VPS such as:

- `1 vCPU`
- `2 GB RAM`

then expect problems during build and import.

What may still work:

- `OSRM` can sometimes be built if you add swap and build slowly

What is not a good fit:

- `Nominatim` on the same tiny machine

If you are on a low-memory VPS, add swap before heavy builds:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
swapon --show
```

## Download Zimbabwe OSM Data

Use Geofabrik:

- page: `https://download.geofabrik.de/africa/zimbabwe.html`
- file: `https://download.geofabrik.de/africa/zimbabwe-latest.osm.pbf`

Create the data folders first:

```bash
sudo mkdir -p /opt/src
sudo mkdir -p /opt/maps
sudo mkdir -p /opt/maps/zimbabwe
sudo mkdir -p /opt/maps/osrm
sudo chown -R $USER:$USER /opt/src
sudo chown -R $USER:$USER /opt/maps
```

Download the extract:

```bash
cd /opt/maps/zimbabwe
wget https://download.geofabrik.de/africa/zimbabwe-latest.osm.pbf
ls -lh /opt/maps/zimbabwe
```

## Native Linux Setup

Use a Linux server directly.

Best choice:

- `Ubuntu 22.04` or `Ubuntu 24.04`
- dedicated VM or bare metal
- do not try to run `OSRM` and `Nominatim` natively on Windows for production

This path is more manual, but it works well and gives you full control.

## OSRM Setup

### What OSRM Will Do

- route geometry
- route distance
- route duration
- ETA basis

### Install Build Dependencies

```bash
sudo apt update
sudo apt install -y build-essential git cmake ninja-build pkg-config \
  autoconf automake libtool curl zip unzip tar \
  libbz2-dev libxml2-dev libzip-dev libboost-all-dev \
  lua5.2 liblua5.2-dev libtbb-dev libarchive-dev
```

### Clone the Source and Install `vcpkg`

Current `OSRM` builds are smoother with the preset flow plus `vcpkg`.

```bash
cd /opt/src
git clone https://github.com/Project-OSRM/osrm-backend.git
git clone https://github.com/microsoft/vcpkg.git ~/vcpkg
~/vcpkg/bootstrap-vcpkg.sh
export VCPKG_ROOT=~/vcpkg
```

If you open a new shell later, set this again before rebuilding:

```bash
export VCPKG_ROOT=~/vcpkg
```

### Build and Install `OSRM`

```bash
cd /opt/src/osrm-backend
rm -rf build
cmake --preset ci-linux
cmake --build --preset ci-linux -- -j1
sudo cmake --install build
hash -r
```

Why `-j1`:

- it is safer on small servers
- it reduces RAM pressure during dependency builds

If your server has comfortable RAM and CPU, you can omit `-- -j1`.

### Verify the Install

```bash
which osrm-routed
which osrm-extract
which osrm-partition
which osrm-customize
osrm-routed --version
```

If these are not found, check whether the build actually produced binaries:

```bash
cd /opt/src/osrm-backend
find build -type f \( -name "osrm-routed" -o -name "osrm-extract" -o -name "osrm-partition" -o -name "osrm-customize" \)
```

If the build appears to stop during `vcpkg` dependencies such as `protobuf`, check memory:

```bash
free -h
dmesg | tail -n 50
```

If you see memory pressure, enable swap and rebuild:

```bash
cd /opt/src/osrm-backend
export VCPKG_ROOT=~/vcpkg
rm -rf build
cmake --preset ci-linux
cmake --build --preset ci-linux -- -j1 2>&1 | tee /root/osrm-build.log
```

### Prepare the Zimbabwe Routing Graph

Copy the Zimbabwe extract into the `OSRM` working folder:

```bash
cp /opt/maps/zimbabwe/zimbabwe-latest.osm.pbf /opt/maps/osrm/
cd /opt/maps/osrm
ls -lh
```

Use the built-in car profile from the source tree:

```bash
osrm-extract -p /opt/src/osrm-backend/profiles/car.lua zimbabwe-latest.osm.pbf
osrm-partition zimbabwe-latest.osrm
osrm-customize zimbabwe-latest.osrm
ls -lh /opt/maps/osrm
```

Expected output files in `/opt/maps/osrm` include files like:

- `zimbabwe-latest.osrm`
- `zimbabwe-latest.osrm.cells`
- `zimbabwe-latest.osrm.ebg`
- `zimbabwe-latest.osrm.partition`
- `zimbabwe-latest.osrm.mldgr`

If `osrm-extract` succeeds but `osrm-partition` or `osrm-customize` feels slow, that is normal on a small server.

### Run `OSRM`

```bash
osrm-routed --algorithm mld /opt/maps/osrm/zimbabwe-latest.osrm
```

Test it from another shell:

```bash
curl "http://127.0.0.1:5000/route/v1/driving/28.581,-20.1596;28.600,-20.170?overview=full&geometries=polyline"
```

If the response contains `routes`, `OSRM` is working.

### Run `OSRM` With `systemd`

Create `/etc/systemd/system/osrm-zimbabwe.service`:

```ini
[Unit]
Description=OSRM Zimbabwe
After=network.target

[Service]
ExecStart=/usr/local/bin/osrm-routed --algorithm mld /opt/maps/osrm/zimbabwe-latest.osrm
WorkingDirectory=/opt/maps/osrm
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable osrm-zimbabwe
sudo systemctl start osrm-zimbabwe
sudo systemctl status osrm-zimbabwe
```

## Nominatim Setup

`Nominatim` is heavier than `OSRM`. If resources are tight, put it on a separate machine or use a larger server.

### What Nominatim Will Do

- address search
- reverse geocoding
- place lookup

### Install Dependencies on Ubuntu 22.04

```bash
sudo apt-get update -qq
sudo apt-get install -y build-essential cmake g++ libboost-dev libboost-system-dev \
  libboost-filesystem-dev libexpat1-dev zlib1g-dev libbz2-dev libpq-dev \
  liblua5.3-dev lua5.3 lua-dkjson nlohmann-json3-dev postgresql-14-postgis-3 \
  postgresql-contrib-14 postgresql-14-postgis-3-scripts libicu-dev virtualenv git
```

### Create a Dedicated User

```bash
sudo useradd -d /srv/nominatim -s /bin/bash -m nominatim
sudo -u nominatim bash
export USERNAME=nominatim
export USERHOME=/srv/nominatim
chmod a+x $USERHOME
```

### Build `osm2pgsql`

`Nominatim` needs a recent `osm2pgsql`.

```bash
cd $USERHOME
git clone https://github.com/osm2pgsql-dev/osm2pgsql
mkdir osm2pgsql-build
cd osm2pgsql-build
cmake ../osm2pgsql
make
sudo make install
```

### Install `Nominatim`

```bash
cd $USERHOME
git clone https://github.com/osm-search/Nominatim.git
virtualenv $USERHOME/nominatim-venv
$USERHOME/nominatim-venv/bin/pip install psycopg[binary]
cd $USERHOME/Nominatim
$USERHOME/nominatim-venv/bin/pip install packaging/nominatim-db
```

### Create a Project Directory and Copy Zimbabwe Data

```bash
mkdir -p $USERHOME/nominatim-project
cp /opt/maps/zimbabwe/zimbabwe-latest.osm.pbf $USERHOME/nominatim-project/
cd $USERHOME/nominatim-project
```

### Import the Zimbabwe Dataset

```bash
$USERHOME/nominatim-venv/bin/nominatim import --osm-file zimbabwe-latest.osm.pbf
```

Initial import can take a while.

### Serve the API With `gunicorn`

```bash
$USERHOME/nominatim-venv/bin/pip install packaging/nominatim-api
$USERHOME/nominatim-venv/bin/gunicorn \
  -b 127.0.0.1:8080 \
  -w 4 \
  -k uvicorn.workers.UvicornWorker \
  "nominatim_api.server.falcon.server:run_wsgi()"
```

For production, put `Nominatim` behind `nginx` and run it with `systemd`.

### Test Search

```bash
curl "http://127.0.0.1:8080/search?q=Bulawayo&format=jsonv2&limit=5"
```

### Test Reverse Geocoding

```bash
curl "http://127.0.0.1:8080/reverse?lat=-20.1596&lon=28.581&format=jsonv2"
```

## Optional: Self-Hosted Tiles

Your app can render OSM-based tiles. For true self-hosting, serve your own tiles too.

Two common options:

- `TileServer GL`
- `tegola`

Simplest path:

1. generate or obtain MBTiles for Zimbabwe
2. serve them with a native tile server
3. point `MapLibre` to your own tile endpoint

If you want full raster tiles, bind your tile server to `127.0.0.1:8081` and reverse proxy it through `nginx` or `caddy`.

## TrustCars Backend Configuration

Point your backend to your own services with env vars.

Recommended `.env` values:

```env
OSRM_BASE_URL=http://127.0.0.1:5000
OSM_ROUTING_BASE_URL=http://127.0.0.1:5000

NOMINATIM_BASE_URL=http://127.0.0.1:8080
OSM_GEOCODER_BASE_URL=http://127.0.0.1:8080
```

If your backend and map services run on different machines, use their private network IPs instead of `127.0.0.1`.

## Reverse Proxy

Put `nginx` or `caddy` in front of these services.

Recommended public routes:

- `https://maps.yourdomain.com/osrm`
- `https://maps.yourdomain.com/nominatim`
- `https://maps.yourdomain.com/tiles`

Example `nginx` shape:

```nginx
server {
    server_name maps.yourdomain.com;

    location /osrm/ {
        proxy_pass http://127.0.0.1:5000/;
    }

    location /nominatim/ {
        proxy_pass http://127.0.0.1:8080/;
    }

    location /tiles/ {
        proxy_pass http://127.0.0.1:8081/;
    }
}
```

## Production Notes

- do not expose raw `Nominatim` openly without rate limits
- add caching for route and search requests
- add firewall rules so only your app/backend can hit internal services if possible
- monitor disk growth
- re-import or update Zimbabwe data regularly

## Updating Zimbabwe Data

At minimum, refresh periodically:

1. download latest `zimbabwe-latest.osm.pbf`
2. rebuild `OSRM` graph
3. reimport or update `Nominatim`
4. rebuild tiles if self-hosting tiles

If you want less downtime, do blue/green style map data deploys:

- build new dataset in a second folder
- start the second service
- switch proxy

## What TrustCars Uses After This

After full self-hosting:

- routing requests go to your own `OSRM`
- place search and place details go to your own `Nominatim`
- map rendering can go to your own tiles
- mobile/admin map UI uses `MapLibre`

That means:

- no Google Maps billing
- no per-request vendor map charges
- full control over Zimbabwe-only map infrastructure

## Recommended Next Step

Start with this exact order:

1. deploy `OSRM`
2. deploy `Nominatim`
3. update backend `.env`
4. test ride routing and place search
5. self-host tiles last
