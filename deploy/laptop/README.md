# MMS staging on a laptop — operator runbook

Run the full MMS staging stack on a Windows 11 laptop with Docker Desktop, exposed
publicly via a Cloudflare Tunnel terminating on a GoDaddy-managed domain, with
Cloudflare Access in front of every endpoint except the payment webhook.

This file is a copy-paste runbook. Work through the phases top-to-bottom; do not
skip Phase A (the public hostname must exist before Phase D verification works).

## What this stack looks like

```
operator's browser (allowlisted email)
        │
        ▼  HTTPS, Cloudflare-issued cert
    Cloudflare Edge ──► Cloudflare Access (OTP) ──► Cloudflared (Windows service)
                                                              │
                                                              ▼  HTTP localhost:80
                                                  Docker Desktop on the laptop
                                                    nginx → ris-frontend / ris-api
                                                            ris-postgres, ris-redis
```

Inbound from the internet:
- All paths require Cloudflare Access (Google SSO with email OTP as break-glass)
  **except** the two payment webhook paths (`/api/payments/webhook/mtn` and
  `/api/payments/webhook/airtel`), which are protected by HMAC validation in
  `src/services/payments/`.

## Prerequisites

- Windows 11, admin rights (for `winget` and the cloudflared Windows service).
- Docker Desktop running, signed in.
- Git for Windows (provides Git Bash + openssl).
- A Cloudflare account with Zero Trust enabled (free tier is fine).
- A GoDaddy-registered domain whose nameservers either point at Cloudflare
  **or** can have a CNAME for `staging` added directly. This runbook uses the
  GoDaddy-CNAME path (no nameserver swap required).
- A GitHub Personal Access Token (PAT) with `read:packages` scope to pull the
  private images from GHCR.
- The repo cloned locally; this runbook assumes the repo root as the working
  directory unless stated otherwise.

---

## Phase A — Cloudflare Tunnel + DNS

### A.1 Install cloudflared (Windows 11, elevated PowerShell)

Open PowerShell as Administrator (right-click → Run as administrator):

```powershell
winget install --id Cloudflare.cloudflared
```

Confirm the binary is on PATH:

```powershell
cloudflared --version
```

### A.2 Create the tunnel in the Zero Trust dashboard

1. Open `https://one.dash.cloudflare.com` and sign in.
2. Go to **Networks → Tunnels → Create tunnel**.
3. Connector type: **Cloudflared**. Click **Next**.
4. Tunnel name: `mms-staging`. Click **Save tunnel**.
5. The dashboard shows an install command that includes a long token. It looks
   like:

   ```text
   cloudflared service install eyJhIjoi...verylong...token
   ```

6. Copy that whole command and run it in the same elevated PowerShell window.
   This:
   - Installs cloudflared as a Windows service.
   - Stores the tunnel token under `C:\Windows\System32\config\systemprofile\.cloudflared\`.
   - Starts the service so the connector dials Cloudflare.
7. Back in the dashboard the tunnel should flip to **HEALTHY** within 30 s.
   Click **Next**.

### A.3 Add the public hostname

In the tunnel's **Public Hostname** tab, click **Add a public hostname**:

- **Subdomain:** `staging`
- **Domain:** `<your-domain>` (the dashboard auto-lists Cloudflare-managed
  domains; if your domain is GoDaddy-managed and not yet on Cloudflare, see
  A.5 below — you'll skip this dropdown step and add the CNAME on GoDaddy
  instead)
- **Service Type:** `HTTP`
- **URL:** `localhost:80`

Click **Save hostname**. Note the tunnel's **UUID** shown in the tunnel
overview — you will need it for DNS in step A.5.

### A.4 Cloudflare Access — three policies on one application

**Identity provider setup (one-time, before creating the application):**

In Zero Trust → **Settings → Authentication → Login methods**, add **Google**
as a login method (or GitHub if Google isn't an option). Google SSO is the
**primary** identity provider for MMS staging — it requires the operator's
own Google account and any 2FA on it (including hardware keys). Keep
**One-time PIN** enabled too, but only as a documented break-glass for
operators without a Google account.

Cloudflare Zero Trust → **Access → Applications → Add an application →
Self-hosted**.

**Application:**

- Application name: `MMS Staging`
- Session duration: **24 hours**
- Application domain: `staging.<your-domain>`
- Accepted identity providers: **Google** (primary) + **One-time PIN**
  (break-glass).

Configure three policies on this single application. **Order matters** —
Cloudflare evaluates Bypass before Allow, so the two webhook policies must
be listed first to catch MTN/Airtel callbacks before the OTP gate.

**Policy 1 — `Webhook bypass — MTN` (Action: Bypass)**

- Rule: **Path** equals exactly `/api/payments/webhook/mtn` AND **Method**
  equals `POST`.
- Include rule: **Everyone**.

**Policy 2 — `Webhook bypass — Airtel` (Action: Bypass)**

- Rule: **Path** equals exactly `/api/payments/webhook/airtel` AND **Method**
  equals `POST`.
- Include rule: **Everyone**.

**Policy 3 — `Allowlist` (Action: Allow)**

- Include rule: **Emails** → list every operator email that should be allowed
  in (one per line).
- Require rule: **Login methods** = `Google` (forces SSO; if a particular
  operator has no Google account, add them to a separate `Break-glass`
  policy that allows OTP — keep that allowlist tight).
- Require rule: **Countries** = `Uganda` plus the operator's current country
  (BoU FIA 2004 data-localisation posture).
- **Purpose justification** (toggle on the policy): prompt text =
  `Why are you accessing MMS staging? (logged for compliance — PDPA 2019)`.

Webhook paths use **exact** matchers, not the wildcard `/api/payments/webhook/*`,
so any future route added under that prefix falls back to the Allowlist by
default — narrowing the blast radius if an unauthenticated route lands by
mistake. Confirmed via `src/services/payments/payments.routes.ts:70,73` that
exactly two webhook routes exist (MTN + Airtel). SendGrid is **not** a
payments webhook in this repo — its email integration is outbound-only — so
no SendGrid bypass is needed.

The webhooks are still protected because `src/services/payments/` validates
the HMAC signature of every incoming request and rejects mismatches. The
Bypass policies just let the request reach the origin; HMAC is the actual
authentication.

### A.5 GoDaddy DNS — point `staging` at the tunnel

Take the tunnel UUID from the Tunnel overview and create one record in GoDaddy
DNS Manager:

| Type  | Name    | Value                              | TTL |
|-------|---------|------------------------------------|-----|
| CNAME | staging | `<tunnel-uuid>.cfargotunnel.com`   | 600 |

Save and wait 1–2 minutes for propagation. Verify with:

```powershell
nslookup staging.<your-domain>
```

The answer should chain through `cfargotunnel.com` to a Cloudflare IP.

> If your domain is fully on Cloudflare instead of GoDaddy, the dashboard adds
> the CNAME for you automatically when you saved the public hostname in A.3 —
> skip this step.

### A.6 Cloudflare WAF rate-limit on webhook paths

In Cloudflare dashboard → **Security → WAF → Rate limiting rules**, add one
rule as defence in depth in case HMAC validation regresses upstream:

- **Name:** `Throttle payment webhooks`
- **Match expression:** `(http.request.uri.path eq "/api/payments/webhook/mtn") or (http.request.uri.path eq "/api/payments/webhook/airtel")`
- **Threshold:** 60 requests per 1 minute, per IP
- **Action:** Block
- **Duration:** 10 minutes

### A.7 Cloudflare Service Token (for CI smoke test) — TODO

The CI's `smoke-tests-staging` job currently probes Cloudflare's
`/cdn-cgi/trace`; that proves the tunnel is up but doesn't prove the app is
up. To upgrade later:

1. Zero Trust → **Access → Service Auth → Service Tokens** → create token
   `mms-staging-ci-smoke`. Save the Client ID and Client Secret.
2. Create a separate Access Application scoped to
   `staging.<your-domain>/health` only. Add a policy with
   **Require → Service Auth** including the new token.
3. In the GitHub repo → Settings → Secrets and variables → Actions, add:
   - `CF_ACCESS_CLIENT_ID` = the token's Client ID
   - `CF_ACCESS_CLIENT_SECRET` = the token's Client Secret
4. Update the smoke job in `.github/workflows/deploy.yml` to send those two
   headers and probe `/health` directly:

   ```yaml
   - name: Probe staging health via Service Token
     run: |
       curl -fsS --max-time 30 \
         -H "CF-Access-Client-Id: ${{ secrets.CF_ACCESS_CLIENT_ID }}" \
         -H "CF-Access-Client-Secret: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}" \
         "${{ vars.STAGING_URL }}/health" | jq -e '.status == "ok"'
   ```

Leave this as a follow-up — the `/cdn-cgi/trace` probe in the current CI is
sufficient to detect tunnel outages while the rest of the rollout settles.

### A.8 Cloudflare audit log retention

Cloudflare Free retains Zero Trust → Logs → Access for 24 hours only. For
PDPA 2019 record-keeping (≥ 6 months of access trails to pair with the
immutable `audit_logs` table in Postgres):

- Either upgrade to Cloudflare Zero Trust paid for extended retention, **or**
- Enable **Logpush** (Zero Trust → Logs → Logpush) to push Access events to
  an S3 bucket / Datadog / a self-hosted webhook receiver. Cheapest stable
  destination is an S3 bucket with a 12-month lifecycle.

Pick one before relying on the URL for demos to BoU or compliance reviewers.

---

## Phase B — Generate `.env`

In **Git Bash** at the repo root:

```bash
bash deploy/laptop/bootstrap-env.sh
```

The script will:

1. Refuse to overwrite an existing `.env` (use `--force` to replace it).
2. Copy `.env.production` → `.env`.
3. Generate `JWT_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD` with `openssl`.
4. Prompt: `Enter your domain (e.g. mms.example.com):` — type your GoDaddy
   apex (no `staging.` prefix; the script adds it).
5. Rewrite `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` to `https://staging.<domain>`.
6. Force `NODE_ENV=production`.
7. Print a redacted summary so you can confirm everything took.

MTN, Airtel, and SendGrid credentials are intentionally **left as placeholders**.
Wire them up via the `uganda-compliance` specialist when staging needs to make
real provider calls.

---

## Phase C — First boot

Pre-flight: `docker-compose.production.yml` mounts `./deploy/postgres/postgresql.conf`
read-only (line 85). If that file is missing the postgres container will fail
to start. Confirm before continuing:

```bash
test -f ./deploy/postgres/postgresql.conf || {
  echo "ERROR: deploy/postgres/postgresql.conf is required (mounted by"
  echo "       docker-compose.production.yml:85). Restore it before continuing."
  exit 1
}
```

Then:

```bash
docker login ghcr.io
# username: your GitHub username
# password: a PAT with read:packages scope

docker compose -f docker-compose.production.yml pull
./deploy/deploy.sh
```

`./deploy/deploy.sh` runs pre-flight checks (refuses to start with placeholder
secrets), starts Postgres + Redis with healthchecks, runs migrations, then
brings up the API, frontend, and nginx.

Expected output ends with `MMS Platform deployed successfully!` and a URL.

---

## Phase D — Verify

These four checks confirm the public path is correctly authenticated and the
private path is unauthenticated.

### D.1 Local health (no Cloudflare in the loop)

```bash
curl http://localhost/health
```

Expect HTTP 200 with the API health JSON.

### D.2 Public, allowlisted email

Open `https://staging.<your-domain>/health` in a browser using an email that's
in Policy 1's allowlist. You should be redirected to a Cloudflare OTP page,
receive a 6-digit code by email, and after entering it land on JSON 200.

### D.3 Public, anonymous (no Access cookie)

```bash
curl -i https://staging.<your-domain>/health
```

Expect a Cloudflare-issued HTML response asking you to authenticate (302/200
to the Access login page) — **not** a JSON 200. Confirms Access is in front
of the path.

### D.4 Public, non-allowlisted email

Open an incognito window, hit `https://staging.<your-domain>/`, and request an
OTP for an email that is NOT in Policy 1. Cloudflare should return a 403
"You are not allowed" page.

Then on the laptop:

```bash
docker logs nginx
```

Expect **zero** request lines for that attempt — Cloudflare blocked the
request at the edge before it reached the tunnel.

### D.5 App login

Open `https://staging.<your-domain>/`, complete OTP, then log into MMS itself
with a seeded user. Watch the DevTools Network tab.

#### Seed test users (one-shot, idempotent)

The repo ships [`deploy/seed-users.js`](../seed-users.js): 14 users (2 per role)
with the deterministic password `TestPassword123!`. The script uses
`ON CONFLICT (email) DO NOTHING` and wraps in `BEGIN/COMMIT`, so it is safe to
re-run.

To seed via the running `mms-api` container (Git Bash on Windows needs
`MSYS_NO_PATHCONV=1` to keep `/tmp/...` from being rewritten to a Windows
path):

```bash
docker cp deploy/seed-users.js mms-api:/tmp/seed-users.js
MSYS_NO_PATHCONV=1 docker exec -e NODE_PATH=/app/node_modules \
  mms-api node /tmp/seed-users.js
```

Test creds (staging-only, deterministic — **do NOT use against production**):

| Role               | Login emails                                          |
|--------------------|-------------------------------------------------------|
| supplier           | `supplier1@test.ris.co.ug`, `supplier2@test.ris.co.ug` |
| credit_officer     | `credit1@test.ris.co.ug`, `credit2@test.ris.co.ug`     |
| finance_manager    | `finance1@test.ris.co.ug`, `finance2@test.ris.co.ug`   |
| management         | `md1@test.ris.co.ug`, `md2@test.ris.co.ug`             |
| compliance_officer | `compliance1@test.ris.co.ug`, `compliance2@test.ris.co.ug` |
| auditor            | `auditor1@test.ris.co.ug`, `auditor2@test.ris.co.ug`   |
| legal              | `legal1@test.ris.co.ug`, `legal2@test.ris.co.ug`       |

Password for all 14: `TestPassword123!`.

For the production stack, do NOT run this script. The CI synthetic monitor
(see [#23](https://github.com/256MMcode/MMS-Platform/issues/23)) will use
GH Actions secrets `SMOKE_USER` / `SMOKE_PASS` against a separately-seeded
canary account with a rotated password (tracked in
[#19](https://github.com/256MMcode/MMS-Platform/issues/19)).

> **Known pre-existing bug — flag separately, not part of this runbook.**
> The refresh-token round-trip currently breaks because of a cookie-path
> issue in `src/services/auth/auth.controller.ts:392`. Login works, but a
> session refresh after the access token expires will fail. Track this as a
> separate issue; do not patch from inside the staging-rollout work.

---

## Operational notes

### Stop the laptop from sleeping

A laptop that sleeps takes the staging stack offline. In Windows:
**Settings → System → Power & Battery → Screen and Sleep → When plugged in,
turn off after: Never** (set both screen and sleep). Leave the laptop on
mains power.

### Do NOT put real customer data on the laptop's Postgres

The laptop has no UPS. A power-loss-mid-write event will corrupt Postgres
WAL and you will lose the database. Staging is for synthetic/test data
only — production runs elsewhere.

### Stopping staging

Stop the application stack but leave the Cloudflare Tunnel running:

```bash
docker compose -f docker-compose.production.yml down
```

The cloudflared Windows service stays connected and the public DNS still
resolves; visitors will see a Cloudflare 502 (origin unreachable) until you
bring docker back up. To take the tunnel itself offline, **disable** the
tunnel from the Zero Trust dashboard (Networks → Tunnels → `mms-staging` →
… → Pause/Delete) — that severs the connection without uninstalling the
Windows service.

### Restarting

```bash
docker compose -f docker-compose.production.yml pull
./deploy/deploy.sh
```

The deploy script is idempotent — re-running it pulls newer images, runs any
new migrations, and rolls the API/frontend/nginx containers.

---

## Files in this directory

| File                | Purpose                                                                 |
|---------------------|-------------------------------------------------------------------------|
| `README.md`         | This runbook.                                                           |
| `bootstrap-env.sh`  | One-shot `.env` generator (Git Bash on Windows 11).                     |
| `aws-teardown.md`   | Checklist for retiring the EC2-based staging once the laptop is live.   |
