# Deploying Meet Point

Meet Point is static files plus one PHP script (`api/meetup.php`). The routing runs in the visitors' browsers,
so the server only stores events. A basic shared host is enough.

## Requirements

- PHP **7.4 or newer** with the `mbstring` and `json` extensions (both are standard).
- A web server that runs PHP (Apache with mod_php or php-fpm, nginx with php-fpm, Caddy, …).
- The `data/events/` folder must be **writable by the PHP user**.
- HTTPS is strongly recommended: the "Use my location" button and one-click link copying only work on HTTPS (or localhost).
- Disk: about 20 MB for the app plus data, plus a few KB per event. No database. No cron job needed.
- The server needs **no outbound internet**. The visitors' browsers call third-party services themselves (see the table below).

## Getting the code when the repository is private

GitHub has no "anyone with the link" access for private repositories. Choose one:

- **Invite a person** (they need a GitHub account): repo → Settings → Collaborators → Add people (read access is enough), or
  `gh api -X PUT repos/Tagiix/meetpoint/collaborators/<github-user> -f permission=pull`. They accept the emailed invitation, then `git clone`.
- **Deploy key for a server or an agent** (read-only, scoped to this one repo, no personal account involved):
  on the server run `ssh-keygen -t ed25519 -f ~/.ssh/meetpoint_deploy -N ""`, then add `~/.ssh/meetpoint_deploy.pub` under
  repo → Settings → Deploy keys (leave "Allow write access" off). Clone with
  `GIT_SSH_COMMAND="ssh -i ~/.ssh/meetpoint_deploy -o IdentitiesOnly=yes" git clone git@github.com:Tagiix/meetpoint.git`.
- **A zip, no GitHub account needed**: `git archive --format=zip -o meetpoint.zip HEAD` (about 6 MB compressed), then send the file
  by any channel and unzip it on the server. Collaborators can also use the green Code → Download ZIP button.
- **Make it public** (Settings → Danger zone → Change visibility) if anyone with the link should be able to clone it. The repo contains no secrets
  and no personal data (event files are not committed), but see the data licences in [DATA.md](DATA.md) first.

## Steps

1. Get the files onto the server (the repo includes the built data, so nothing needs building):

        git clone <this repo> /var/www/meetpoint        # or upload a zip of the repo

2. Make the event store writable by the web server user (`www-data` on Debian/Ubuntu, `apache` on RHEL, your own user on shared hosting):

        sudo chown -R www-data:www-data /var/www/meetpoint/data/events
        sudo chmod 775 /var/www/meetpoint/data/events

3. Point your web server at the folder (examples below), reload it, and check:

        tools/smoke_test.sh https://your.domain/          # every line should say PASS

The app uses only relative URLs, so it also works in a subfolder (for example `https://example.org/meetpoint/`).
Run the smoke test against that exact URL.

## Apache

Put the folder in your document root (or an Alias) and make sure `.htaccess` files are honoured
(`AllowOverride All`, at least `FileInfo` and `Indexes`). The repo's `.htaccess` enables compression and caching
for the JSON data. Nothing else is required. Optional hardening in the vhost:

    <Directory /var/www/meetpoint/data/events>
        Require all denied
    </Directory>

## nginx (php-fpm)

    server {
        server_name your.domain;
        root /var/www/meetpoint;
        index index.php index.html;

        location / { try_files $uri $uri/ =404; }
        location ~ ^/(index|api/.+)\.php$ {
            include snippets/fastcgi-php.conf;
            fastcgi_pass unix:/run/php/php8.3-fpm.sock;      # adjust to your PHP version
        }
        location ^~ /data/events/ { deny all; }              # defence in depth (see Security)
        location ~ /\.ht { deny all; }
        gzip on; gzip_types application/json text/css application/javascript;
        location /data/ { expires 1d; }
        location ~* \.(js|css|html)$ { add_header Cache-Control "no-cache"; }   # re-check on every load
        # index.php stamps every script, style and data URL with a build id, so an update can never be mixed with old cached files
    }

nginx ignores `.htaccess`, which is why the explicit `deny` above matters.

## Security model (read this before exposing it)

- There are **no accounts**. Anyone who has an event's invite link can view it and add a position. Treat the link like a password.
- The organizer is whoever holds the **organizer key** (created with the event, stored in the organizer's browser, copyable as the "organizer link"). Only it can change settings, remove people or delete the event.
- Each person who adds a position gets a secret that lets them edit or remove **only their own** entries. Secrets are stored hashed.
- Positions are personal data. Event files are stored as `data/events/<id>.php` starting with a line that stops PHP, so requesting one over the web returns an empty 404 on any server, even without a deny rule. `tools/smoke_test.sh` verifies this. Events are deleted automatically 90 days after they were last written (checked whenever a new event is created). At most 500 events are kept.
- Limits enforced in PHP: 10 people per event, 40 characters per name, positions inside Île-de-France only, 20 KB per request.
- There is no rate limiting. If the site is public, add it at the web server (for example nginx `limit_req` on `/api/meetup.php`).

## Backups and housekeeping

- The only state is `data/events/`. Back it up (or don't: events are short-lived) with `tar czf events.tgz data/events`.
- To purge everything: delete `data/events/*.php` (keep `.htaccess`).

## Updating

    git pull                          # data and code travel together
    tools/smoke_test.sh https://your.domain/

Event files are untouched by updates. To refresh timetable or map data, see [DATA.md](DATA.md) (optional, every few weeks).

## What the browsers call (so firewalls and privacy policies can account for it)

| Service | Used for | Sent |
|---|---|---|
| cdnjs.cloudflare.com | Leaflet (map library) | nothing personal |
| api-adresse.data.gouv.fr (French government address service) | address search and "address of this pin" | the address typed, or the pin's coordinates |
| routing.openstreetmap.de (public OSRM) | walking, cycling and car route shapes for the selected result | start and end coordinates |

The OSRM demo server is not meant for heavy use. For a busy site, self-host OSRM and change the URL in `assets/app.js` (`OSRM` constant and `refine()`); the app falls back to straight-line estimates if it is unreachable.
To remove the CDN dependency, download Leaflet 1.9.4 into `assets/` and change the two tags in `index.php`.

## Checklist for an agent or script

    # 1. prerequisites
    php -v                                   # >= 7.4
    php -m | grep -i mbstring                # must print mbstring
    # 2. install
    git clone <repo> <dir> && cd <dir>
    chown -R <php-user> data/events && chmod 775 data/events
    # 3. configure the web server (Apache: nothing; nginx: block above), reload it
    # 4. verify: must print ALL PASSED and exit 0
    tools/smoke_test.sh https://your.domain/
    # 5. if a check fails, docs/TROUBLESHOOTING.md maps each failure to its fix
