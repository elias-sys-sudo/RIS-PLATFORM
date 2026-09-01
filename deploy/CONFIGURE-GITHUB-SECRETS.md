# GitHub repo configuration — step-by-step

This is what to click in the GitHub web UI so the `deploy-staging` job in
`.github/workflows/deploy.yml` can SSH into your AWS EC2 staging box.

You do every step in the browser. Nothing is pasted into a chat or terminal
that I can see — the SSH private key lives only on your laptop and inside
GitHub's secret store.

## Step 1 — Open the right page

1. Go to `https://github.com/256MMcode/RIS-Platform`.
2. Click **Settings** (top nav, far right).
3. In the left sidebar: **Secrets and variables → Actions**.

You're on the page titled "Actions secrets and variables". It has two tabs:
**Secrets** (default) and **Variables**.

## Step 2 — Add the three Secrets

Click **New repository secret** for each row below. Name on the left,
value-source on the right.

| Name               | Where to get the value                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_HOST`     | AWS Console → EC2 → Instances → click your staging instance → **Details** tab → **Public IPv4 DNS** (full hostname, like `ec2-3-12-345-67.eu-west-1.compute.amazonaws.com`). If you use an Elastic IP, you can use that IP instead.                                                                                                                     |
| `STAGING_SSH_USER` | The username you type when you SSH today. Common values: `ubuntu` (Ubuntu AMIs), `ec2-user` (Amazon Linux), `admin` (Debian). If unsure, check the AMI name on the instance — for "Ubuntu Server …" it's `ubuntu`.                                                                                                                                      |
| `STAGING_SSH_KEY`  | Open the `.pem` file you use to SSH today (whichever lets you log in to the staging box) in a plain text editor — Notepad, VS Code, anything. Select **everything** including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----` lines. Paste it into the secret value field. Don't add quotes, don't trim trailing newline. |

After clicking **Add secret**, the value is hashed by GitHub and cannot be
read back — only overwritten. That's the right model.

## Step 3 — Add the Variables

Switch to the **Variables** tab (next to Secrets). Click **New repository
variable** for each row.

| Name                | Value                                                                                            | Required                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `STAGING_URL`       | The public URL you use today to reach staging, e.g. `https://staging.ris.ug`. No trailing slash. | **Required** — Stage 7 health check uses it. |
| `STAGING_SSH_PORT`  | Only set if your EC2 SSH listens on something other than 22.                                     | Optional                                     |
| `STAGING_REPO_PATH` | Absolute path to the repo on EC2 if it's NOT at `~/RIS-Platform`.                                | Optional                                     |

## Step 4 — Verify EC2 is ready

Run `deploy/bootstrap-staging.sh` on the EC2 box (one command, idempotent):

```bash
ssh <your-ssh-user>@<staging-host>
cd ~          # or wherever you want the repo
curl -fsSL https://raw.githubusercontent.com/256MMcode/RIS-Platform/develop/deploy/bootstrap-staging.sh | bash
```

The script:

- Clones the repo (or updates it if already cloned).
- Generates a `.env` with strong random secrets if one doesn't exist.
- Prompts for a GitHub Personal Access Token (read:packages scope) and does
  `docker login ghcr.io`.
- Runs `./deploy/deploy.sh` — pulls the latest images CI built, runs
  migrations, brings up Postgres + Redis + API + frontend + nginx.

You'll be asked for one input: a GitHub PAT. Create it at
[github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=read:packages&description=ris-staging-ec2)
with the `read:packages` scope. The script stores it inside Docker's config
on the box — it does not leak back to the chat.

## Step 5 — Verify the security group

The CI runner SSHs in from GitHub's runner IPs (these change). Open AWS
Console → EC2 → Security Groups → the group attached to staging:

- Inbound rule for port 22:
  - **Quickest (acceptable for staging):** Source = `0.0.0.0/0`.
  - **Safer:** Source = GitHub Actions IP ranges, refreshed daily by a small
    Lambda or cron that hits `https://api.github.com/meta`.

If you change the rule, save it.

## Step 6 — Re-trigger CI to verify

The push that introduced `deploy-staging` is already on `develop`. To re-run
that workflow with the secrets in place:

1. Go to **Actions** tab on the repo.
2. Open the most recent run on `develop`.
3. Click **Re-run all jobs** (top right).

The pipeline takes ~15-20 minutes. Watch the `Stage 6b — Deploy to AWS
Staging` job — its log shows the SSH connection and the `deploy.sh` output.

When Stage 7 (smoke test) goes green, the staging URL is live with the new
code.

## Rollback / manual deploy

```bash
ssh <user>@<staging-host>
cd ~/RIS-Platform
git fetch origin && git reset --hard origin/develop   # or a specific SHA
./deploy/deploy.sh
```
