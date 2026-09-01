# TLS setup runbook — Let's Encrypt for staging.raphaintegrated.com

> One-time bootstrap + ongoing renewal for HTTPS on the RIS staging box. The same compose file ports to production (see Section 9).

This runbook covers the Let's Encrypt TLS setup landed in branch `feat/staging-tls-lets-encrypt`:

- **nginx** terminates TLS on :443 with Mozilla Intermediate ciphers, HSTS, OCSP stapling
- **certbot sidecar** runs `certbot renew --webroot` every 12h
- **First-time bootstrap** is manual (one operator command) — see Section 2
- **Renewal does NOT auto-reload nginx** — deliberate trade-off, see Section 5

**Total time for first-time bootstrap: ~10 min** (most of it is the staging-cert dry run).

---

## Why Let's Encrypt + webroot

We chose Let's Encrypt over AWS Certificate Manager because:

- **No AWS load balancer needed** — Lightsail single-instance + ACM requires fronting with a Lightsail LB ($18/mo extra). LE on the box is free.
- **Webroot mode** lets nginx keep serving traffic during renewal — no `:80` rebind, no downtime
- **Certbot in a sidecar container** avoids host-level cron + host-level certbot install. The whole TLS stack is in `docker-compose.production.yml`, reproducible across boxes.
- **90-day certs** force the renewal pipeline to actually work — caught early, not at year-end

We pin to the **webroot** challenge (not DNS-01) because the staging box has a public IP and port 80 is already open. DNS-01 would require giving certbot GoDaddy API credentials — not worth the blast radius for staging.

---

## 1. Pre-flight checks

Before touching the box, verify three things from your laptop:

### 1.1 DNS is pointing at the box

```bash
nslookup staging.raphaintegrated.com 8.8.8.8
```

Expected: `Address: 3.77.191.179`. If you see anything else, the GoDaddy A record hasn't propagated yet — wait 5 min and re-check. **Do not proceed until DNS is correct** — Let's Encrypt will fail the HTTP-01 challenge and burn a rate-limit slot.

### 1.2 Lightsail firewall has 443 open

AWS Lightsail console → your instance → **Networking** tab → **IPv4 Firewall**. You should see:

| Application | Protocol | Port |
|---|---|---|
| SSH | TCP | 22 |
| HTTP | TCP | 80 |
| HTTPS | TCP | 443 |

If 443 is missing, add it now (see Section 7 for exact steps). The cert request will fail at the validation step if 443 isn't open — Let's Encrypt issues the cert via HTTP-01 on :80, but verification post-issue requires :443.

### 1.3 Latest develop is deployed

```bash
ssh ubuntu@3.77.191.179 "cd ~/RIS-Platform && git log --oneline -5 && git status"
```

You should see the `feat/staging-tls-lets-encrypt` merge commit in the log. If the branch isn't merged yet, merge it to `develop` first — the compose file changes need to be on the box before bootstrap.

---

## 2. First-time bootstrap

SSH to the Lightsail box:

```bash
ssh ubuntu@3.77.191.179
```

### 2.1 Pull latest and bring the stack up

```bash
cd ~/RIS-Platform
git pull origin develop
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

All containers should be `Up` / `healthy`. nginx is currently serving HTTP-only on :80 (it will fail to start on :443 because there's no cert yet — that's expected and handled by the bootstrap script).

### 2.2 DRY RUN against Let's Encrypt staging environment first

**Always do this before the real request.** Let's Encrypt staging issues an untrusted cert from a fake CA — browsers show a warning, but there's **no rate limit**. The real environment caps you at 5 failures/hour and 50 issuances/week per domain. Burning the real limit because of a typo in the bootstrap script is a multi-day outage.

```bash
./deploy/get-cert.sh --le-staging
```

The script will:
1. Stop the nginx container so certbot can bind :80 in standalone mode
2. Run certbot against `https://acme-staging-v02.api.letsencrypt.org` to request a cert for `staging.raphaintegrated.com`
3. Drop the cert into the `letsencrypt` named volume
4. Restart nginx

Verify the staging cert was placed:

```bash
docker run --rm -v ris-platform_letsencrypt:/etc/letsencrypt alpine \
  ls -la /etc/letsencrypt/live/staging.raphaintegrated.com/
```

You should see `fullchain.pem`, `privkey.pem`, `cert.pem`, `chain.pem` as symlinks.

Quick verify nginx is now serving on :443 (with the untrusted staging cert — `curl -k` ignores the trust failure):

```bash
curl -kI https://staging.raphaintegrated.com/api/health
```

Expect `HTTP/2 200`. If you get connection refused, nginx didn't pick up the cert — check `docker logs ris-nginx --tail=50`.

### 2.3 Clear the staging cert before requesting the real one

The real certbot will refuse to overwrite an existing cert with the same name. Delete the staging artifacts first:

```bash
docker run --rm -v ris-platform_letsencrypt:/etc/letsencrypt alpine \
  rm -rf /etc/letsencrypt/live/staging.raphaintegrated.com \
         /etc/letsencrypt/archive/staging.raphaintegrated.com \
         /etc/letsencrypt/renewal/staging.raphaintegrated.com.conf
```

### 2.4 Request the real cert

```bash
./deploy/get-cert.sh
```

Same flow as 2.2, but hits the real ACME directory and produces a publicly-trusted cert. Renewal config is written to `/etc/letsencrypt/renewal/staging.raphaintegrated.com.conf` — the sidecar reads this file every 12h.

---

## 3. Verification

### 3.1 HTTP→HTTPS redirect

```bash
curl -I http://staging.raphaintegrated.com/api/health
```

Expect `HTTP/1.1 301 Moved Permanently` with `Location: https://staging.raphaintegrated.com/api/health`.

### 3.2 HTTPS endpoint + HSTS header

```bash
curl -I https://staging.raphaintegrated.com/api/health
```

Expected response headers:

```
HTTP/2 200
strict-transport-security: max-age=15768000; includeSubDomains
content-type: application/json
```

`max-age=15768000` is 6 months — the staging value. Production bumps to 1 year (`31536000`) — see Section 9.

### 3.3 Cert chain inspection

```bash
openssl s_client -connect staging.raphaintegrated.com:443 \
  -servername staging.raphaintegrated.com </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -issuer -subject
```

Expected output:

```
notBefore=<today's date>
notAfter=<today + 90 days>
issuer=C = US, O = Let's Encrypt, CN = R3   (or E1/R10/R11 — LE rotates)
subject=CN = staging.raphaintegrated.com
```

If `issuer` says **STAGING** anything, you're still on the staging cert — go back to 2.3 and clear it.

### 3.4 OCSP stapling

```bash
echo | openssl s_client -connect staging.raphaintegrated.com:443 \
  -servername staging.raphaintegrated.com -status 2>/dev/null \
  | grep -A 1 "OCSP response"
```

Expect `OCSP Response Status: successful`. If you see `no response sent`, see Section 8.4.

### 3.5 SSL Labs grade (optional but recommended)

Open https://www.ssllabs.com/ssltest/analyze.html?d=staging.raphaintegrated.com&hideResults=on in a browser. Expect **A** or **A+** with Mozilla Intermediate cipher suite. Anything below A means something is misconfigured.

---

## 4. Update STAGING_URL CI variable

Stage 7 smoke test in `.github/workflows/staging-deploy.yml` hits `$STAGING_URL/api/health`. Currently it's `http://...`. Flip it to HTTPS so the smoke test actually exercises the TLS path:

```bash
gh variable set STAGING_URL --body "https://staging.raphaintegrated.com"
gh variable list | grep STAGING_URL
```

Next CI run will use the HTTPS URL. If smoke test starts failing with cert errors, the GitHub runner's CA bundle is fine — investigate via the curl commands in Section 3.

---

## 5. Renewal strategy

### 5.1 How the sidecar works

`docker-compose.production.yml` declares:

```yaml
ris-certbot:
  image: certbot/certbot:latest
  entrypoint: /bin/sh -c 'trap exit TERM; while :; do certbot renew --webroot -w /var/www/certbot --quiet; sleep 12h & wait $${!}; done'
  volumes:
    - letsencrypt:/etc/letsencrypt
    - certbot_webroot:/var/www/certbot
  restart: unless-stopped
```

Every 12h it runs `certbot renew --webroot`. Certbot only actually renews if the cert has **<30 days left** — until then it's a fast no-op. So in steady state: most checks do nothing, then ~day 60 of the cert's life it renews, then back to no-ops until day 60 of the next cert.

### 5.2 Why renewal does NOT auto-reload nginx

After certbot writes the new cert, nginx is still serving the **old** cert from memory. To pick up the new one, nginx needs a `SIGHUP` (`nginx -s reload`).

The textbook fix is to give the certbot container access to the docker socket so it can `docker exec ris-nginx nginx -s reload`. **We don't do this.** Mounting `/var/run/docker.sock` into a container is a well-known container-escape vector — anything that can talk to the docker socket is effectively root on the host. The certbot container pulls from `certbot/certbot:latest` which we don't control. Trading a real-money fintech's host for a 5-second nginx reload is not the right call.

### 5.3 The trade-off

nginx picks up the new cert **on next deploy**. Stage 6b of every staging deploy runs:

```bash
docker compose -f docker-compose.production.yml up -d
```

which restarts the nginx container if its config / image / volumes changed. In practice, **nginx restarts on every develop push** (we deploy on every merge), so the cert is picked up within hours of renewal.

Worst case: certbot renews at day 60, no deploys happen, day 90 hits, cert expires, site goes down. To prevent this, the sidecar's renewal logs are checked weekly (Section 6.1). If renewal is happening and no deploy has run in >14 days, manually reload (Section 6.2).

A future hardening pass adds a signal-file + nginx-side watchdog (Section 10) — does the reload without mounting docker.sock.

---

## 6. Operational runbook

### 6.1 Check last renewal attempt

```bash
docker logs ris-certbot --tail=50
```

A healthy log shows entries like:

```
Cert not yet due for renewal
Processing /etc/letsencrypt/renewal/staging.raphaintegrated.com.conf
The following certificates are not due for renewal yet:
  /etc/letsencrypt/live/staging.raphaintegrated.com/fullchain.pem expires on 2026-08-24 (skipped)
No renewals were attempted.
```

If you see actual renewal output (`Renewing an existing certificate for staging.raphaintegrated.com`), check Section 6.2 — nginx still has the old cert in memory.

### 6.2 Force nginx to pick up a freshly-renewed cert

```bash
docker exec ris-nginx nginx -t && docker exec ris-nginx nginx -s reload
```

`nginx -t` validates the config before reload — never skip it, a bad config + `-s reload` will keep the old (now-broken) config but log errors.

### 6.3 Cert file locations

Inside the `letsencrypt` named volume (mounted as `/etc/letsencrypt` in nginx and certbot containers):

```
/etc/letsencrypt/live/staging.raphaintegrated.com/fullchain.pem    # cert + chain (nginx reads this)
/etc/letsencrypt/live/staging.raphaintegrated.com/privkey.pem      # private key (chmod 600)
/etc/letsencrypt/live/staging.raphaintegrated.com/chain.pem        # chain only (for OCSP stapling)
/etc/letsencrypt/renewal/staging.raphaintegrated.com.conf          # renewal config (don't edit by hand)
```

To inspect from the host:

```bash
docker run --rm -v ris-platform_letsencrypt:/etc/letsencrypt alpine \
  ls -la /etc/letsencrypt/live/staging.raphaintegrated.com/
```

### 6.4 Cert expiry check (sanity)

```bash
docker exec ris-nginx openssl x509 \
  -in /etc/letsencrypt/live/staging.raphaintegrated.com/fullchain.pem \
  -noout -enddate
```

Compare to what `openssl s_client` reports from outside (Section 3.3). If they disagree, nginx is serving an old cert from memory — Section 6.2.

---

## 7. Lightsail firewall — exact steps

AWS Lightsail console:

1. https://lightsail.aws.amazon.com → sign in
2. Click your instance (the one at `3.77.191.179`)
3. **Networking** tab
4. **IPv4 Firewall** section → **Add rule**
5. Application: **Custom**
6. Protocol: **TCP**
7. Port or range: **443**
8. Source: **Any IPv4 address** (or restrict to specific IPs if doing internal testing only — but then ACME validation from LE's servers will fail, so don't restrict on staging)
9. Click **Create**

If the instance is dual-stack (has an IPv6 address), repeat for **IPv6 Firewall** — same fields, same port 443, source **Any IPv6 address**.

Also confirm port 80 is still open — certbot needs it for the HTTP-01 challenge and for the HTTP→HTTPS redirect.

---

## 8. Troubleshooting

### 8.1 Rate limit hit (Let's Encrypt)

Symptoms: `too many failed authorizations recently` or `too many certificates already issued for staging.raphaintegrated.com`.

Limits (per LE docs):
- **5 failures/hour** per account+hostname
- **50 issuances/week** per registered domain

What to do:
1. Stop running `get-cert.sh` immediately. Each retry burns the budget further.
2. Check `https://crt.sh/?q=staging.raphaintegrated.com` to see what was issued recently.
3. If you're stuck on failures (not issuances), wait 60 min. The window slides.
4. If you've hit the 50/week issuance cap, you have to wait it out — there's no override. **This is why Section 2.2 (staging dry-run) is mandatory.**
5. Meanwhile, the last successfully-issued cert is still valid for ~90 days from its issue date. Site stays up.

### 8.2 DNS not propagated

Symptoms: certbot says `DNS problem: NXDOMAIN looking up A for staging.raphaintegrated.com` or `Detail: Fetching http://staging.raphaintegrated.com/.well-known/acme-challenge/... Timeout during connect`.

Diagnostic:

```bash
nslookup staging.raphaintegrated.com 8.8.8.8
nslookup staging.raphaintegrated.com 1.1.1.1
dig +trace staging.raphaintegrated.com
```

All three should agree on `3.77.191.179`. If GoDaddy says one thing and 8.8.8.8 / 1.1.1.1 say another, propagation isn't done — wait 10-15 min and re-check. GoDaddy occasionally takes longer to propagate to Google DNS than to Cloudflare DNS.

### 8.3 Port 443 blocked

Symptoms: cert was issued successfully but `curl https://staging.raphaintegrated.com/` from outside hangs / refuses connect, while `curl https://localhost/` on the box works.

Check:
1. Lightsail firewall has 443 open (Section 7)
2. nginx is actually listening: `docker exec ris-nginx ss -tlnp | grep 443`
3. Host iptables isn't blocking: `sudo iptables -L -n | grep 443` (Lightsail Ubuntu doesn't usually have host iptables rules, but check)
4. From outside: `nc -zv staging.raphaintegrated.com 443` — should connect

### 8.4 OCSP stapling failures

Symptoms: SSL Labs shows "OCSP stapling: No" or the `openssl s_client -status` check in 3.4 shows `no response sent`.

OCSP responses are cached by nginx for ~1 hour after first fetch. The first request after nginx starts may not have it yet — wait 5 min and re-check.

If it still fails after 30 min:

```bash
docker exec ris-nginx cat /etc/nginx/nginx.conf | grep -A2 ssl_stapling
```

Should show:

```
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/letsencrypt/live/staging.raphaintegrated.com/chain.pem;
```

The `chain.pem` (not `fullchain.pem`) is the intermediate cert that nginx uses to verify OCSP responses from LE. If it's missing or pointing at the wrong file, OCSP stapling silently disables itself — nginx logs a warning but continues serving.

Restart nginx to clear OCSP cache: `docker compose -f docker-compose.production.yml restart ris-nginx`. Wait 5 min for first OCSP fetch, re-check.

### 8.5 nginx won't start because cert files don't exist

Symptoms (in `docker logs ris-nginx`): `cannot load certificate "/etc/letsencrypt/live/staging.raphaintegrated.com/fullchain.pem": No such file or directory`.

You're in the chicken-and-egg state: nginx config references a cert that hasn't been issued yet. This is exactly what `get-cert.sh` handles — it stops nginx, runs certbot in standalone mode, then restarts. If you got here some other way (e.g. manually deleted the letsencrypt volume), re-run `./deploy/get-cert.sh`.

---

## 9. Production migration

When promoting to production:

### 9.1 Pre-flight (same as Section 1, different domain)

- A record for `api.raphaintegrated.com` (or the agreed prod hostname) points at the production Lightsail IP
- Port 443 open on production Lightsail firewall
- Production box has the latest compose file from `main`

### 9.2 Config changes

In `deploy/nginx/nginx.conf`, swap `staging.raphaintegrated.com` → `api.raphaintegrated.com` in the `server_name` directive and the `ssl_certificate*` paths.

In `deploy/get-cert.sh`, update:

```bash
DOMAIN="api.raphaintegrated.com"
LETSENCRYPT_EMAIL="ops@raphaintegrated.com"   # was a personal Gmail on staging
```

Bump HSTS max-age in `deploy/nginx/nginx.conf` from `15768000` (6 months) to `31536000` (1 year):

```
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### 9.3 Run

Same flow as Section 2 — dry-run with `--le-staging`, clear, real run.

### 9.4 After 30 days stable

Submit to https://hstspreload.org/. Submission is a one-way door (browsers ship the list hardcoded in their binaries — removal takes weeks). Only submit once you're sure the site is staying on HTTPS forever and you're never re-issuing on a non-included subdomain.

Requirements for preload submission:
- HSTS header includes `preload` directive
- `max-age` ≥ 31536000 (1 year)
- `includeSubDomains` set
- All subdomains served over HTTPS

So before submitting, change the nginx header to:

```
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

---

## 10. Future hardening

Deferred for the staging cutover — track these as separate tickets:

1. **Auto-reload nginx on renewal** — Use a signal-file pattern: certbot writes `/etc/letsencrypt/.renewed-staging.raphaintegrated.com` via a `--deploy-hook`; a small nginx-side watchdog (inotify-tools, runs in the nginx container as a sidecar process) sees the file and sends `SIGHUP` to nginx. **No docker.sock mount needed.** Alternative: cron inside the nginx container that runs `nginx -s reload` if any cert file's mtime is newer than nginx's pid-file mtime.

2. **CAA DNS record** — Add a `CAA` record at GoDaddy:

   ```
   raphaintegrated.com.  IN  CAA  0 issue "letsencrypt.org"
   ```

   This prevents any other CA from issuing certs for the domain even if someone compromises a registrar account. Defence-in-depth against mis-issuance.

3. **Content-Security-Policy header** — Currently we only set HSTS. Add CSP once the frontend is stable enough to enumerate every CDN it loads from. Start with `Content-Security-Policy-Report-Only` for a week, then promote to enforcing.

4. **HSTS preload** — See Section 9.4. Wait 30+ days after production cutover.

5. **Switch to ECDSA certs** — Let's Encrypt issues both RSA and ECDSA. ECDSA P-256 keys are ~10x smaller, handshake is ~2x faster, same security. Pass `--key-type ecdsa --elliptic-curve secp256r1` to certbot in `get-cert.sh`. Wait until after we've validated the RSA path for a couple of renewal cycles — fewer moving parts during initial cutover.

6. **Monitor cert expiry externally** — Add a simple uptime-monitor check (e.g. UptimeRobot, BetterUptime free tier) that alerts if the cert is <14 days from expiry. Belt + braces against the sidecar silently failing.

7. **TLS 1.3 only** — We currently allow TLS 1.2 + 1.3 (Mozilla Intermediate). Once we confirm no Bank-of-Uganda partner systems are on 1.2 only, drop to 1.3 only. Smaller attack surface, smaller handshake.
