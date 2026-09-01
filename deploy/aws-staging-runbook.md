# AWS staging — auto-deploy runbook

Every push to `develop` builds a Docker image (Stage 6 in
`.github/workflows/deploy.yml`) and now also SSHs into the EC2 staging box and
runs `deploy/deploy.sh` (Stage 6b). For this to work you need a few one-time
items configured.

## Prerequisites on the EC2 host

1. **Repo cloned** at a known path (default `~/RIS-Platform` on the SSH user's
   home). The deploy script pulls the latest commit on every CI run; the
   initial clone is manual.

   ```bash
   git clone https://github.com/256MMcode/RIS-Platform.git ~/RIS-Platform
   ```

2. **Production `.env` populated** — `deploy/deploy.sh` validates that
   `POSTGRES_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, and
   `CORS_ALLOWED_ORIGINS` are real values (not placeholders).

   ```bash
   cd ~/RIS-Platform
   cp .env.production .env   # or copy from your secrets manager
   chmod 600 .env
   ```

3. **Docker logged in to GHCR** so the host can pull the private images CI
   built. Credentials persist in `~/.docker/config.json`.

   ```bash
   docker login ghcr.io
   # username: a GitHub user with read:packages on the repo
   # password: a Personal Access Token with read:packages scope
   ```

4. **Docker + Compose v2** installed and the user has rights to run
   `docker compose` without sudo.

## GitHub repository configuration

### Secrets (Settings → Secrets and variables → Actions → New repository secret)

| Name               | Value                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGING_HOST`     | EC2 public DNS or EIP (e.g. `ec2-3-1-2-3.eu-west-1.compute.amazonaws.com`)                                                                                                  |
| `STAGING_SSH_USER` | OS login user (usually `ubuntu` for Ubuntu AMIs, `ec2-user` for Amazon Linux)                                                                                               |
| `STAGING_SSH_KEY`  | Full private-key contents (`-----BEGIN OPENSSH PRIVATE KEY----- ... -----END OPENSSH PRIVATE KEY-----`) matching one of the keys in the instance's `~/.ssh/authorized_keys` |

### Variables (Settings → Secrets and variables → Actions → Variables tab)

| Name                | Value                                                 | Required |
| ------------------- | ----------------------------------------------------- | -------- |
| `STAGING_URL`       | Public URL of staging (e.g. `https://staging.ris.ug`) | Yes      |
| `STAGING_SSH_PORT`  | Port if not 22                                        | No       |
| `STAGING_REPO_PATH` | Repo path on EC2 if not `~/RIS-Platform`              | No       |

## EC2 security group

The CI runner is on GitHub-hosted IPs that rotate. Two safe options:

1. **Allow 22/tcp from `0.0.0.0/0`** — simplest, but make the SSH key 4096-bit
   ed25519 and disable password auth. Brute force at scale is impractical with
   a non-default user + key-only auth, but you'll see noise in auth logs.
2. **Allowlist GitHub Actions IP ranges** — pull from
   `https://api.github.com/meta` (the `actions` array) and put them in the
   security group. Set up a small daily job (Lambda or a cron on the box) to
   refresh the list when GitHub publishes new ranges.

Recommendation: option 2 for production-grade isolation. Option 1 is fine for
day-one if you also enable Fail2Ban or `sshd_config` `MaxAuthTries 3` +
`LoginGraceTime 20s`.

## What happens on each push to `develop`

```
push → Stage 1 lint → Stage 2 sec scan → Stage 3 unit tests
     → Stage 4 integration → Stage 5 ZAP → Stage 6 build+push image
     → Stage 6b deploy-staging  ← new
            ssh into STAGING_HOST
            git fetch && git reset --hard origin/develop
            export API_IMAGE=ghcr.io/...:sha-<short>
            ./deploy/deploy.sh   # pull → migrate → restart
     → Stage 7 smoke test         curl <STAGING_URL>/api/health
```

Total time: ~18–25 minutes from push to staging running new code.

## Manual deploy (fallback)

If CI is down or you want to deploy a specific SHA:

```bash
ssh <user>@<STAGING_HOST>
cd ~/RIS-Platform
git fetch origin develop
git reset --hard origin/develop
API_IMAGE=ghcr.io/256mmcode/ris-platform:sha-<short> \
FRONTEND_IMAGE=ghcr.io/256mmcode/ris-platform-frontend:sha-<short> \
./deploy/deploy.sh
```

## Rollback

```bash
ssh <user>@<STAGING_HOST>
cd ~/RIS-Platform
# pick a previous good SHA from `git log` or GHCR's image list
API_IMAGE=ghcr.io/256mmcode/ris-platform:sha-<previous> \
FRONTEND_IMAGE=ghcr.io/256mmcode/ris-platform-frontend:sha-<previous> \
./deploy/deploy.sh --pull
./deploy/deploy.sh --restart
```

`--migrate` is intentionally NOT run on rollback — schema rollbacks are manual
and depend on the migration content.
