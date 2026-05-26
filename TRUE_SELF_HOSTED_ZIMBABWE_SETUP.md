# True Self-Hosted Zimbabwe Map Setup

This is the updated `TrustCars` runbook for deploying the full Zimbabwe self-hosted map stack on a fresh Linux server.

It is written to avoid the exact problems we hit last time:

- too-small VPS during build
- old `cmake` causing `CMP0156` errors
- missing `OSRM` dependencies from the old manual build flow
- `Nominatim` install path issues
- missing PostgreSQL roles like `nominatim` and `www-data`
- `nominatim-db` failing because `country_osm_grid.sql.gz` was missing
- confusion around `sudo` while inside the `nominatim` shell
- `Nominatim` listening only on `127.0.0.1` when we wanted public access
- backend env pointing at the wrong host or port

This guide assumes:

- `Ubuntu 24.04` or `Ubuntu 22.04`
- a fresh server
- `Zimbabwe` only
- native install, not Docker

## Final Result

At the end you will have:

- `OSRM` routing running on port `5000`
- `Nominatim` search and reverse geocoding running on port `8088`
- `systemd` services for both
- backend env values ready for `TrustCars`

## Recommended Server Size

Minimum practical size for `OSRM + Nominatim` on one box:

- `4 vCPU`
- `8 GB RAM`
- `80 GB+ SSD`

Better:

- `4 vCPU`
- `16 GB RAM`
- `100 GB+ SSD`

Do not repeat the tiny VPS path for full setup:

- `1 vCPU`
- `2 GB RAM`

That size can sometimes build `OSRM` with swap, but it is a bad fit for `Nominatim`.

## Step 1: Confirm the Server Basics

Run this first:

```bash
lsb_release -a
uname -a
free -h
df -h
```

What you want to confirm:

- Ubuntu version
- available RAM
- enough disk

## Step 2: Add Swap First

Even on a decent server, add swap before heavy builds.

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
swapon --show
```

If you skip this and the build dies silently, check:

```bash
dmesg | tail -n 50
```

If you see memory pressure or killed processes, rebuild with swap enabled.

## Step 3: Create the Working Folders

Use these exact folders:

```bash
sudo mkdir -p /opt/src
sudo mkdir -p /opt/maps
sudo mkdir -p /opt/maps/zimbabwe
sudo mkdir -p /opt/maps/osrm
sudo chown -R $USER:$USER /opt/src
sudo chown -R $USER:$USER /opt/maps
```

Verify:

```bash
ls -ld /opt/src /opt/maps /opt/maps/zimbabwe /opt/maps/osrm
```

## Step 4: Download Zimbabwe OSM Data

```bash
cd /opt/maps/zimbabwe
wget https://download.geofabrik.de/africa/zimbabwe-latest.osm.pbf
ls -lh /opt/maps/zimbabwe
```

Expected file:

- `zimbabwe-latest.osm.pbf`

## Step 5: Upgrade `cmake` Before Building `OSRM`

This is one of the most important fixes from last time.

Newer `OSRM` source uses a CMake policy that older Ubuntu packages do not understand.

Check your current version:

```bash
cmake --version
```

If it is below `3.29`, upgrade it first.

### Ubuntu 24.04

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates gpg wget

test -f /usr/share/doc/kitware-archive-keyring/copyright || \
wget -O - https://apt.kitware.com/keys/kitware-archive-latest.asc 2>/dev/null | \
gpg --dearmor - | sudo tee /usr/share/keyrings/kitware-archive-keyring.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/kitware-archive-keyring.gpg] https://apt.kitware.com/ubuntu/ noble main' | \
sudo tee /etc/apt/sources.list.d/kitware.list >/dev/null

sudo apt-get update
sudo apt-get install -y kitware-archive-keyring cmake
cmake --version
```

### Ubuntu 22.04

Use `jammy` instead of `noble`:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates gpg wget

test -f /usr/share/doc/kitware-archive-keyring/copyright || \
wget -O - https://apt.kitware.com/keys/kitware-archive-latest.asc 2>/dev/null | \
gpg --dearmor - | sudo tee /usr/share/keyrings/kitware-archive-keyring.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/kitware-archive-keyring.gpg] https://apt.kitware.com/ubuntu/ jammy main' | \
sudo tee /etc/apt/sources.list.d/kitware.list >/dev/null

sudo apt-get update
sudo apt-get install -y kitware-archive-keyring cmake
cmake --version
```

Do not continue until `cmake --version` shows `3.29+`.

## Step 6: Install `OSRM` Build Dependencies

```bash
sudo apt update
sudo apt install -y \
  build-essential git cmake ninja-build pkg-config \
  autoconf automake libtool curl zip unzip tar \
  libbz2-dev libxml2-dev libzip-dev libboost-all-dev \
  lua5.2 liblua5.2-dev libtbb-dev libarchive-dev
```

## Step 7: Build `OSRM` Using the Supported Preset Flow

Do not use the old `cmake ..` flow.

That was what led to missing `libarchive`, `fmt`, and `RapidJSON` errors before.

Use this exact method instead:

```bash
cd /opt/src
git clone https://github.com/Project-OSRM/osrm-backend.git
git clone https://github.com/microsoft/vcpkg.git ~/vcpkg
~/vcpkg/bootstrap-vcpkg.sh
export VCPKG_ROOT=~/vcpkg
```

If you open a new shell later, always re-export:

```bash
export VCPKG_ROOT=~/vcpkg
```

### Build and Install

```bash
cd /opt/src/osrm-backend
rm -rf build
cmake --preset ci-linux
cmake --build --preset ci-linux -- -j1
sudo cmake --install build
hash -r
```

Use `-j1` unless you know you have plenty of RAM.

### Verify `OSRM`

```bash
which osrm-routed
which osrm-extract
which osrm-partition
which osrm-customize
osrm-routed --version
```

If commands are not found, check whether binaries were built:

```bash
cd /opt/src/osrm-backend
find build -type f \( -name "osrm-routed" -o -name "osrm-extract" -o -name "osrm-partition" -o -name "osrm-customize" \)
```

If build failed, rebuild with logs:

```bash
cd /opt/src/osrm-backend
export VCPKG_ROOT=~/vcpkg
rm -rf build
cmake --preset ci-linux 2>&1 | tee /root/osrm-configure.log
cmake --build --preset ci-linux -- -j1 2>&1 | tee /root/osrm-build.log
```

Then inspect:

```bash
tail -n 80 /root/osrm-configure.log
tail -n 80 /root/osrm-build.log
```

## Step 8: Prepare the Zimbabwe Routing Graph

Copy the `.pbf` into the `OSRM` work folder:

```bash
cp /opt/maps/zimbabwe/zimbabwe-latest.osm.pbf /opt/maps/osrm/
cd /opt/maps/osrm
ls -lh
```

Generate the routing graph:

```bash
osrm-extract -p /opt/src/osrm-backend/profiles/car.lua zimbabwe-latest.osm.pbf
osrm-partition zimbabwe-latest.osrm
osrm-customize zimbabwe-latest.osrm
ls -lh /opt/maps/osrm
```

Expected outputs include files like:

- `zimbabwe-latest.osrm`
- `zimbabwe-latest.osrm.partition`
- `zimbabwe-latest.osrm.cells`
- `zimbabwe-latest.osrm.mldgr`

## Step 9: Test `OSRM` Manually

Start it in the foreground:

```bash
osrm-routed --algorithm mld /opt/maps/osrm/zimbabwe-latest.osrm
```

Leave that shell running.

From a second shell, test:

```bash
curl "http://127.0.0.1:5000/route/v1/driving/28.581,-20.1596;28.600,-20.170?overview=full&geometries=polyline"
```

You want a JSON response with `routes`.

## Step 10: Create the `OSRM` `systemd` Service

Create the service file:

```bash
sudo tee /etc/systemd/system/osrm-zimbabwe.service > /dev/null <<'EOF'
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
EOF
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable osrm-zimbabwe
sudo systemctl start osrm-zimbabwe
sudo systemctl status osrm-zimbabwe
```

Verify listening:

```bash
ss -tulpn | grep 5000
```

## Step 11: Install `Nominatim` Dependencies

This part differs by Ubuntu release.

### First, check your release

```bash
lsb_release -a
```

### Ubuntu 24.04

```bash
sudo apt-get update -qq
sudo apt-get install -y \
  build-essential cmake g++ git \
  libboost-dev libboost-system-dev libboost-filesystem-dev \
  libexpat1-dev zlib1g-dev libbz2-dev libpq-dev \
  liblua5.3-dev lua5.3 lua-dkjson \
  nlohmann-json3-dev libicu-dev virtualenv \
  postgresql postgresql-contrib postgis \
  postgresql-16-postgis-3 postgresql-16-postgis-3-scripts
```

### Ubuntu 22.04

```bash
sudo apt-get update -qq
sudo apt-get install -y \
  build-essential cmake g++ git \
  libboost-dev libboost-system-dev libboost-filesystem-dev \
  libexpat1-dev zlib1g-dev libbz2-dev libpq-dev \
  liblua5.3-dev lua5.3 lua-dkjson \
  nlohmann-json3-dev libicu-dev virtualenv \
  postgresql postgresql-contrib postgis \
  postgresql-14-postgis-3 postgresql-14-postgis-3-scripts
```

If unsure which `postgresql-XX-postgis-3` package exists:

```bash
apt-cache search postgresql | grep postgis
```

## Step 12: Create the `nominatim` Linux User

Use a dedicated Unix user.

```bash
sudo useradd -d /srv/nominatim -s /bin/bash -m nominatim
sudo -u nominatim -H bash
export USERHOME=/srv/nominatim
cd $USERHOME
```

Important:

- build as `nominatim`
- install system-level pieces as `root`

Do not use `sudo make install` inside the `nominatim` shell unless that user actually has sudo rights.

## Step 13: Build `osm2pgsql`

From the `nominatim` shell:

```bash
cd $USERHOME
git clone https://github.com/osm2pgsql-dev/osm2pgsql
mkdir osm2pgsql-build
cd osm2pgsql-build
cmake ../osm2pgsql
make
```

Then leave back to `root`:

```bash
exit
```

Install from `root`:

```bash
cd /srv/nominatim/osm2pgsql-build
make install
```

## Step 14: Install `Nominatim`

Go back into the `nominatim` user:

```bash
sudo -u nominatim -H bash
export USERHOME=/srv/nominatim
cd $USERHOME
```

Clone and create the virtualenv:

```bash
git clone https://github.com/osm-search/Nominatim.git
python3 -m virtualenv $USERHOME/nominatim-venv
$USERHOME/nominatim-venv/bin/pip install --upgrade pip
$USERHOME/nominatim-venv/bin/pip install psycopg[binary]
```

### Important fix from last time: download the missing country grid file

Without this, `packaging/nominatim-db` can fail.

```bash
cd $USERHOME/Nominatim
wget -O data/country_osm_grid.sql.gz https://nominatim.org/data/country_grid.sql.gz
ls -lh data/country_osm_grid.sql.gz
```

Now install the DB package from the repo root:

```bash
cd $USERHOME/Nominatim
$USERHOME/nominatim-venv/bin/pip install packaging/nominatim-db
```

## Step 15: Create the PostgreSQL Roles Before Import

Leave the `nominatim` shell:

```bash
exit
whoami
```

You want to be `root`.

Create the required PostgreSQL roles:

```bash
su - postgres -c "createuser -s nominatim"
su - postgres -c "createuser www-data"
su - postgres -c "psql -c '\du'"
```

You should see:

- `nominatim`
- `www-data`

Why this matters:

- `nominatim` is needed for the import
- `www-data` is the read-only web/API role that `Nominatim` expects

## Step 16: Create the Project Folder and Import Zimbabwe

Back into the `nominatim` user:

```bash
su - nominatim
export USERHOME=/srv/nominatim
mkdir -p $USERHOME/nominatim-project
cp /opt/maps/zimbabwe/zimbabwe-latest.osm.pbf $USERHOME/nominatim-project/
cd $USERHOME/nominatim-project
```

Run the import:

```bash
$USERHOME/nominatim-venv/bin/nominatim import --osm-file zimbabwe-latest.osm.pbf
```

If you previously had a failed partial import and see:

- `database "nominatim" already exists`

then leave the shell and drop the database:

```bash
exit
su - postgres -c "dropdb nominatim"
su - nominatim
cd /srv/nominatim/nominatim-project
$USERHOME/nominatim-venv/bin/nominatim import --osm-file zimbabwe-latest.osm.pbf
```

You want to end with something like:

- `Import completed successfully`

## Step 17: Install the API Package

Still from the `nominatim` user:

```bash
cd /srv/nominatim/Nominatim
/srv/nominatim/nominatim-venv/bin/pip install packaging/nominatim-api
/srv/nominatim/nominatim-venv/bin/pip install uvicorn falcon gunicorn
```

Important:

- `packaging/nominatim-api` only works from inside `/srv/nominatim/Nominatim`
- if you run it from `nominatim-project`, it fails because the relative path does not exist

## Step 18: Test `Nominatim` Manually

From the `nominatim` user:

```bash
cd /srv/nominatim/nominatim-project
/srv/nominatim/nominatim-venv/bin/nominatim serve
```

This usually binds to `127.0.0.1:8088`.

From another shell on the server, test:

```bash
curl "http://127.0.0.1:8088/search?q=Bulawayo&format=jsonv2&limit=5"
curl "http://127.0.0.1:8088/reverse?lat=-20.1596&lon=28.581&format=jsonv2"
```

If both return JSON, the service is working.

## Step 19: Create the `Nominatim` `systemd` Service

You have two choices:

- private bind on `127.0.0.1:8088`
- public bind on `0.0.0.0:8088`

### Recommended: private bind first

```bash
sudo tee /etc/systemd/system/nominatim-zimbabwe.service > /dev/null <<'EOF'
[Unit]
Description=Nominatim Zimbabwe
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=nominatim
WorkingDirectory=/srv/nominatim/nominatim-project
Environment="PATH=/srv/nominatim/nominatim-venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
ExecStart=/srv/nominatim/nominatim-venv/bin/nominatim serve
Restart=always

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nominatim-zimbabwe
sudo systemctl start nominatim-zimbabwe
sudo systemctl status nominatim-zimbabwe
```

Verify:

```bash
ss -tulpn | grep 8088
```

If you see `127.0.0.1:8088`, it is internal-only, which is good if your backend runs on the same server.

## Step 20: Optional Public Exposure

If you want direct browser access before setting up `nginx`, bind publicly with `gunicorn`.

Replace the service with:

```bash
sudo tee /etc/systemd/system/nominatim-zimbabwe.service > /dev/null <<'EOF'
[Unit]
Description=Nominatim Zimbabwe
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=nominatim
WorkingDirectory=/srv/nominatim/nominatim-project
Environment="PATH=/srv/nominatim/nominatim-venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"
ExecStart=/srv/nominatim/nominatim-venv/bin/gunicorn -b 0.0.0.0:8088 -w 4 -k uvicorn.workers.UvicornWorker "nominatim_api.server.falcon.server:run_wsgi()"
Restart=always

[Install]
WantedBy=multi-user.target
EOF
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart nominatim-zimbabwe
sudo systemctl status nominatim-zimbabwe
ss -tulpn | grep 8088
```

Open firewall if needed:

```bash
sudo ufw allow 8088/tcp
sudo ufw allow 5000/tcp
sudo ufw status
```

Then test from your browser:

```text
http://YOUR_SERVER_IP:8088/search?q=Bulawayo&format=jsonv2&limit=5
http://YOUR_SERVER_IP:8088/reverse?lat=-20.1596&lon=28.581&format=jsonv2
```

## Step 21: `TrustCars` Backend Env

### If backend runs on the same server

Use loopback:

```env
OSRM_BASE_URL=http://127.0.0.1:5000
OSM_ROUTING_BASE_URL=http://127.0.0.1:5000
NOMINATIM_BASE_URL=http://127.0.0.1:8088
OSM_GEOCODER_BASE_URL=http://127.0.0.1:8088
```

### If backend runs locally on your laptop

Use the remote server IP:

```env
OSRM_BASE_URL=http://YOUR_SERVER_IP:5000
OSM_ROUTING_BASE_URL=http://YOUR_SERVER_IP:5000
NOMINATIM_BASE_URL=http://YOUR_SERVER_IP:8088
OSM_GEOCODER_BASE_URL=http://YOUR_SERVER_IP:8088
```

Only use `127.0.0.1` if the backend is on the same machine as the map services.

## Step 22: Public Browser Test URLs

### `OSRM`

```text
http://YOUR_SERVER_IP:5000/route/v1/driving/28.581,-20.1596;28.600,-20.170?overview=full&geometries=polyline
```

### `Nominatim` search

```text
http://YOUR_SERVER_IP:8088/search?q=Bulawayo&format=jsonv2&limit=5
```

### `Nominatim` reverse

```text
http://YOUR_SERVER_IP:8088/reverse?lat=-20.1596&lon=28.581&format=jsonv2
```

If `OSRM` works publicly but `Nominatim` does not, check:

```bash
ss -tulpn | grep 8088
```

If it says `127.0.0.1:8088`, it is not exposed publicly yet.

## Step 23: Recommended Final Production Shape

After basic success, put `nginx` in front and expose:

- `/osrm`
- `/nominatim`

Instead of raw ports.

That gives you:

- cleaner URLs
- easier TLS later
- safer private internal ports

## Step 24: Quick Rebuild / Migration Checklist for a New Server

Use this order every time:

1. provision the server
2. add swap
3. install base packages
4. upgrade `cmake`
5. download Zimbabwe extract
6. build and install `OSRM`
7. build the Zimbabwe routing graph
8. test `OSRM`
9. create `OSRM` `systemd`
10. install PostgreSQL/PostGIS and `Nominatim` deps
11. create Linux `nominatim` user
12. build `osm2pgsql`
13. install `Nominatim`
14. create PostgreSQL roles `nominatim` and `www-data`
15. import Zimbabwe into `Nominatim`
16. test `Nominatim`
17. create `Nominatim` `systemd`
18. expose publicly only if needed
19. update backend env
20. test ride routing, place search, reverse geocoding

## Step 25: Most Important Mistakes To Avoid

Do not repeat these:

- do not build `OSRM` with the old `cmake ..` path
- do not skip the `cmake` upgrade check
- do not try full install on a `2 GB RAM` VPS
- do not run `sudo make install` from inside the `nominatim` shell unless that user actually has sudo access
- do not forget `country_osm_grid.sql.gz`
- do not forget PostgreSQL roles `nominatim` and `www-data`
- do not assume `127.0.0.1` means the remote server when your backend is running locally
- do not expect browser access to `Nominatim` if it is still bound to `127.0.0.1:8088`

## Final `TrustCars` Result

After this setup:

- `/api/maps/directions` uses your own `OSRM`
- `/api/maps/places/autocomplete` uses your own `Nominatim`
- `/api/maps/places/details` uses your own `Nominatim`
- passenger and driver route distance use your own map infrastructure
- place search and reverse geocoding no longer depend on Google

That gives you:

- no per-request Google routing cost
- no per-request Google place search cost
- Zimbabwe-focused map infrastructure you control
