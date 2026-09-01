# Email setup runbook — Resend + GoDaddy aliases for RIS

> One-time setup. Works for both staging and production (different API keys per env).

This runbook gets real transactional email working for RIS:
- **Resend** delivers outbound mail from `raphaintegrated.com` (provider-agnostic SMTP — swappable with Postmark, Mailgun, SES, SendGrid)
- **GoDaddy** forwards 10 role-based aliases (e.g. `confirm@`, `payments@`) to your Gmail for reply handling
- Server boots with `EMAIL_PROVIDER_VERIFIED=true` after the operator confirms the provider is production-ready

**Total time: ~15 min** (Resend approval is instant; the slow step is waiting ~5 min for DNS to propagate).

---

## Why Resend (and not AWS SES)

We initially set up AWS SES, but their sandbox-mode approval was slow / unreliable for new accounts in regulated industries. SES sandbox **silently rejects** any recipient not pre-verified in their console, which left new suppliers stuck at "Please verify your email" with no operator-visible failure signal — the exact incident that triggered this runbook.

Resend was chosen because:
- **No human review** — DKIM verification only, ~5 minutes
- **Same DKIM/SPF/DMARC model** as SES (so future provider swaps are config-only)
- **3,000 emails/month free**, then $20/mo for 50k (fits our ~5k/mo projection)
- **Bounce/complaint webhooks** out of the box
- **Used in production by** Vercel, Linear, Notion, Cal.com — proven deliverability

To swap providers later (Postmark, Mailgun, SES out of sandbox, SendGrid): only the four `SES_SMTP_*` env vars change. The codebase is provider-agnostic SMTP.

---

## Phase A — Resend setup

### A.1 Sign up

1. https://resend.com/signup
2. Sign in with `myaicloudsystem@gmail.com` (or your operator account).
3. Free tier, no credit card required.

### A.2 Add the domain

1. Dashboard → **Domains** (left sidebar) → **Add Domain**.
2. Domain: `raphaintegrated.com`
3. Region: pick closest to your users. Tokyo (`ap-northeast-1`), Ireland (`eu-west-1`), and Virginia (`us-east-1`) are reasonable for Uganda. Email is async so latency is not user-visible — pick whichever you like.
4. Click **Add**.

Resend gives you **3 DNS records**:

| Type | Name | Value | Notes |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0...wIDAQAB` (~200 chars) | DKIM signing key |
| MX | `send` | `feedback-smtp.<region>.amazonses.com` priority 10 | Bounce feedback (Resend uses SES infra internally — this is normal) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the `send` subdomain |

**Leave the Resend tab open — you'll come back to verify.**

### A.3 Add the 3 DNS records at GoDaddy

1. https://dcc.godaddy.com/control/portfolio/raphaintegrated.com/settings → **DNS** tab → **DNS Records**.
2. **Important rule**: GoDaddy auto-appends `.raphaintegrated.com` to the Name field. So when you type `resend._domainkey`, GoDaddy stores it as `resend._domainkey.raphaintegrated.com`. Don't type the full FQDN.
3. Click **Add New Record** for each:
   - **DKIM (TXT)**: Name `resend._domainkey`, Value `p=MIGfMA0...wIDAQAB` (copy from Resend's UI — use their copy button to avoid truncation)
   - **MX**: Name `send`, Mail Server `feedback-smtp.<your-region>.amazonses.com`, Priority `10`
   - **SPF (TXT)**: Name `send`, Value `v=spf1 include:amazonses.com ~all`
4. TTL: `1 Hour` (default is fine).
5. Save each.

### A.4 Verify DNS propagation

Wait ~2 minutes, then from any machine:

```bash
nslookup -type=TXT resend._domainkey.raphaintegrated.com 8.8.8.8
nslookup -type=MX  send.raphaintegrated.com               8.8.8.8
nslookup -type=TXT send.raphaintegrated.com               8.8.8.8
```

All three should return the values you added. If any are missing, wait another ~5 min — GoDaddy occasionally takes 10–15 min to propagate to Google DNS.

### A.5 Trigger Resend's verification

1. Back to Resend → **Domains** → click `raphaintegrated.com`.
2. Click the `⋮` 3-dot menu next to the domain → **Verify DNS Records**.
3. Status flips from "Not Started" / "Pending" → ✅ **Verified** within ~5 seconds (DNS is already live).

### A.6 Add SPF + DMARC at the root domain (defence-in-depth)

The Resend setup above gives you SPF on the `send` subdomain. For DMARC protection on the root domain, add two more TXT records at GoDaddy:

**SPF (root)** — only needed if you also send from root-addressed senders (rare; skip if all your Resend senders are `*@raphaintegrated.com` aliases, since Resend's `send.<domain>` SPF is what counts):

```
Type:  TXT
Name:  @
Value: v=spf1 include:resend.com ~all
TTL:   1 Hour
```

**DMARC:**

```
Type:  TXT
Name:  _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc-reports@raphaintegrated.com
TTL:   1 Hour
```

> Why `p=none`: starts in monitor-only mode. After ~2 weeks of clean sending logs, upgrade to `p=quarantine` then `p=reject` for strict anti-spoofing. Gradual rollout avoids accidentally blocking legitimate email during the transition.

### A.7 Generate API keys

1. Resend → **API keys** → **Create API Key**
2. Create one for each environment:
   - Name: `ris-staging`, Permission: **Sending access**, Domain: `raphaintegrated.com`
   - Name: `ris-production`, Permission: **Sending access**, Domain: `raphaintegrated.com`
3. **Copy each `re_xxx...` key immediately** — Resend shows it once. Store in a password manager. Never paste in chat / git.

---

## Phase B — GoDaddy email aliases (reply handling)

Each of our 10 sender addresses needs a place for replies to land. Free GoDaddy forwarding sends them all to your Gmail.

### B.1 Set up forwarding aliases

1. https://account.godaddy.com → Products → Email & Office.
2. Find `raphaintegrated.com` → click **Manage**.
3. Look for **Forwarding** or **Email Forwarding** option.
4. Create 10 forwards, all pointing to `myaicloudsystem@gmail.com`:

| Forward from | Forward to | Purpose |
|---|---|---|
| `confirm@raphaintegrated.com` | myaicloudsystem@gmail.com | Buyer magic-link emails |
| `payments@raphaintegrated.com` | myaicloudsystem@gmail.com | Payment/invoice lifecycle |
| `kyc@raphaintegrated.com` | myaicloudsystem@gmail.com | KYC review status |
| `collections@raphaintegrated.com` | myaicloudsystem@gmail.com | Collections/demand letters |
| `support@raphaintegrated.com` | myaicloudsystem@gmail.com | Password reset, welcome, generic |
| `credit@raphaintegrated.com` | myaicloudsystem@gmail.com | Credit officer inbound |
| `finance@raphaintegrated.com` | myaicloudsystem@gmail.com | Finance manager inbound |
| `compliance@raphaintegrated.com` | myaicloudsystem@gmail.com | Compliance officer inbound |
| `legal@raphaintegrated.com` | myaicloudsystem@gmail.com | Legal team inbound |
| `directors@raphaintegrated.com` | myaicloudsystem@gmail.com | Management inbound |

If GoDaddy's UI only lets you create them one at a time, that's fine — 10 forwards × ~30 sec each = 5 min.

> **Caveat:** GoDaddy forwarding has a known quirk — emails forwarded TO Gmail can sometimes be flagged by Gmail's anti-spoofing if the forwarder doesn't strip the original headers properly. If replies aren't reaching your Gmail, the upgrade to Google Workspace ($6/mo) handles it cleanly. For staging, forwarding usually just works.

### B.2 (Optional) Configure "Send mail as" in Gmail

So you can REPLY as `support@raphaintegrated.com` instead of from your personal Gmail:

1. Gmail → Settings → Accounts → **Send mail as** → Add another email.
2. Name: e.g. `RIS Support`
3. Email: `support@raphaintegrated.com`
4. Treat as alias: checked
5. Next → SMTP server: `smtp.resend.com`, port `465`, username `resend`, password your `re_xxx` Resend API key
6. Secured with TLS
7. Verify (Gmail sends a code to the email — since it forwards to your Gmail, the code arrives in your inbox)
8. Repeat for each of the 10 aliases you want to reply from

Skip this step if you don't need to reply as the role. The forwarding alone lets you READ replies.

---

## Phase C — Configure the server

Update the `.env` file on the staging (and later production) host:

```
# Provider-agnostic SMTP — currently Resend
SES_SMTP_HOST=smtp.resend.com
SES_SMTP_PORT=465
SES_SMTP_USER=resend
SES_SMTP_PASS=<re_xxx key from A.7 — ris-staging for staging, ris-production for prod>

# Sender aliases (must match Phase B forwarding setup)
SES_FROM_DEFAULT=noreply@raphaintegrated.com
SES_FROM_CONFIRM=confirm@raphaintegrated.com
SES_FROM_PAYMENTS=payments@raphaintegrated.com
SES_FROM_KYC=kyc@raphaintegrated.com
SES_FROM_COLLECTIONS=collections@raphaintegrated.com
SES_FROM_SUPPORT=support@raphaintegrated.com

# Operator attestation that the provider is production-ready
# (domain verified, out of sandbox, smoke-tested to Gmail Inbox)
EMAIL_PROVIDER_VERIFIED=true
```

Then restart the API container:

```bash
docker compose -f docker-compose.production.yml restart ris-api
docker compose -f docker-compose.production.yml logs --tail=50 ris-api | grep -iE "smtp|email|notif"
```

The server should boot with no `EMAIL_PROVIDER_VERIFIED must be set` error. If you see that error, you forgot to set `EMAIL_PROVIDER_VERIFIED=true`.

---

## Phase D — Verify deliverability

### D.1 Smoke test from the host

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer <your re_xxx key>" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "RIS Platform <noreply@raphaintegrated.com>",
    "to": "myaicloudsystem@gmail.com",
    "subject": "RIS smoke test",
    "text": "If this lands in Gmail Inbox, the email pipeline is healthy."
  }'
```

Expected response:

```json
{"id":"<uuid>"}
```

Then check Gmail — email should arrive within ~10 seconds in **Inbox** (not Promotions / Spam). Promotions is acceptable for a new domain and improves over weeks of clean sending.

### D.2 End-to-end through the app

1. Open https://staging.raphaintegrated.com/onboarding (or production once live).
2. Register a new supplier with a fresh Gmail address.
3. Verification email arrives in seconds from `confirm@raphaintegrated.com`.
4. Click the magic link → verifies → can sign in.

### D.3 Reputation check

Resend → **Metrics**. Bounce rate < 5%, complaint rate < 0.1% is healthy. If either spikes, the BullMQ notification worker (per `src/services/notifications/CLAUDE.md`) writes `EMAIL_VERIFICATION_DELIVERY_FAILED` audit rows and surfaces stuck users at `GET /admin/email/failed-verifications`.

---

## Cost summary

| Stage | Cost |
|---|---|
| Resend free tier | $0/mo (3,000 emails/month, 100/day) |
| Resend Pro | $20/mo (50,000 emails/month) |
| GoDaddy email forwarding | $0/mo (included with domain) |
| Google Workspace (optional upgrade for real mailboxes) | $6/mo per real human user |

**Realistic early-production cost (≤5,000 emails/mo): $0/mo on Resend free tier.** Step up to Pro ($20/mo) once you cross 3k/mo or need higher daily caps.

---

## Production cutover

When ready to flip production live:

1. Add `app.raphaintegrated.com` (or whatever your prod domain is) as a CNAME / A record at GoDaddy pointing to your production host.
2. On the production server, set the same `.env` keys as Phase C, but with the `ris-production` API key from A.7.
3. Set `EMAIL_PROVIDER_VERIFIED=true` only AFTER you've smoke-tested with D.1.
4. Same Docker image as staging; only env differs.
5. Merge any pending PRs targeting `develop` → main, let CI deploy.

No code, image, or runbook changes between staging and production.

---

## Rollback plan

If Resend has an outage or you need to swap providers urgently:

1. SSH to the host (staging or production).
2. Edit `.env` with the new provider's SMTP credentials. Examples:
   - **Postmark**: `smtp.postmarkapp.com` port 587, user = Server Token, pass = same token
   - **SendGrid**: `smtp.sendgrid.net` port 587, user = `apikey`, pass = SG API key
   - **Mailgun**: `smtp.mailgun.org` port 587, user = `postmaster@<your-domain>`, pass = SMTP password from Mailgun dashboard
   - **AWS SES (if out of sandbox)**: `email-smtp.eu-central-1.amazonaws.com` port 587, user/pass from SES SMTP credentials
3. Update DKIM / SPF DNS records at GoDaddy to match the new provider's records (each provider has its own selector — e.g. SES uses random hashes, Resend uses `resend._domainkey`, Mailgun uses `mta._domainkey`).
4. Restart the API container. Server picks up the new env on boot.

No code changes needed. The notification queue's circuit breaker means a broken provider just pauses sends — it doesn't crash the API. Suppliers can still submit invoices, etc. Email delivery just stops until the swap completes.
