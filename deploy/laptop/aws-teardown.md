# AWS staging teardown checklist

Once the laptop-hosted staging stack (see [`README.md`](./README.md)) is verified
end-to-end, retire the EC2-based staging to stop the AWS bill and reduce the
attack surface. Work through this list top-to-bottom; each section is independent
but the order minimises orphaned resources.

> **Do not start this until laptop staging is fully verified (Phase D in
> README.md passes).** Otherwise CI Stage 7 will have nowhere to deploy and
> the pipeline will go red.

## 1. AWS Console — region `eu-west-1`

Log in to the AWS Console and switch the region to **eu-west-1 (Ireland)** —
all `mms-staging-*` resources live there.

- [ ] **EC2 → Instances** — terminate `mms-staging`
  - Select the instance → Instance state → Terminate instance.
  - Confirm. State will move `running → shutting-down → terminated`.
- [ ] **EC2 → Elastic IPs** — release `mms-staging-eip`
  - Must be done **after** the instance terminates (an attached EIP cannot be
    released). Select the EIP → Actions → Release Elastic IP address.
  - Skipping this step keeps the hourly idle-EIP charge running.
- [ ] **EC2 → Security Groups** — delete `mms-staging-sg`
  - Cannot be deleted while attached to a running ENI; wait for the instance
    to fully terminate, then Actions → Delete security groups.
- [ ] **EC2 → Key Pairs** — delete `mms-staging-admin`
  - Actions → Delete. The matching `.pem` file on your laptop becomes inert
    after this; shred it locally too.
- [ ] **CloudWatch → Log groups** (optional but tidy) — delete any
  `/aws/ec2/mms-staging-*` log groups so Free Tier ingestion stops counting
  against you.

## 2. GitHub repo — Settings → Secrets and variables → Actions

These secrets and variables drove the old EC2 deploy job. Remove the SSH
plumbing and convert the URL to a repo variable so Stage 7 can publish
verification links to the new public URL.

### Secrets to delete

- [ ] `STAGING_HOST`
- [ ] `STAGING_SSH_USER`
- [ ] `STAGING_SSH_KEY`
- [ ] `STAGING_SSH_KEY_B64`

### Variable to set / convert

- [ ] **Repository variable** `STAGING_URL=https://staging.<your-domain>`
  - If `STAGING_URL` exists today as a *secret*, delete the secret first, then
    create it as a *variable* under the **Variables** tab. Variables are
    surfaced to PRs from forks and printed in workflow logs — that is fine
    here because the value is just the public URL.

### Deploy key to delete

- [ ] **Settings → Deploy keys** — delete `mms-staging-ec2`
  - The matching private key was held on the EC2 instance; once the instance
    is gone, the deploy key is dead weight.

### Secrets to KEEP (do not touch)

- [ ] **Confirm** all `PRODUCTION_*` secrets remain untouched. Production
  deploys use a different code path and must not be disturbed.

## 3. Local cleanup (laptop)

- [ ] Delete the EC2 SSH private key file from disk:
      `rm -i ~/.ssh/mms-staging-admin.pem` (or wherever it lives).
- [ ] If you stored the EC2 key in a password manager, archive or delete that
      entry.
- [ ] Remove any leftover `~/.ssh/config` `Host mms-staging` block.

## 4. Verification — next billing cycle

- [ ] Open AWS **Billing → Bills** for the month after teardown.
- [ ] Filter by tag `Project=mms-staging` (or by resource name pattern
      `mms-staging-*`).
- [ ] Confirm the EC2, EBS, and EIP line items are **0.00 USD**.
- [ ] If a non-zero charge appears, walk back through section 1 — the most
      common culprits are an EBS volume that wasn't deleted with the
      instance (EC2 → Volumes) or a forgotten snapshot
      (EC2 → Snapshots).

## 5. Update internal docs

- [ ] In `01-Documents/IMPL-TRACKER-001-implementation-status.md` (or wherever
      staging is referenced), note that staging now runs on the laptop and
      link to `deploy/laptop/README.md`. Do **not** delete the historical EC2
      bootstrap files in `deploy/staging/` — they remain useful as a reference
      for the next environment that needs an EC2 host.
