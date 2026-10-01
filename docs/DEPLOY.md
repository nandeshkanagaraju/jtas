# Deploy JTAS on one EC2 instance

One Ubuntu 24.04 instance in ap-south-1 (Mumbai), x86, running `docker-compose.prod.yml`. Caddy gets a Let's Encrypt certificate for `<dashed-elastic-ip>.sslip.io`. Postgres, Redis and MinIO never leave the Docker network.

Do this in the AWS console. Nothing below assumes the AWS CLI is installed.

The receipts project (`github.com/nandeshkanagaraju/receipts`, live at `13-232-84-149.sslip.io`) already does the parts that are easy to get wrong. Reused from `deploy/aws/ec2.sh`:

- Region `ap-south-1`.
- `t3.micro` is rejected. Receipts moved to `t3.small` because 1 GB could not finish one of its own queries.
- An Elastic IP is allocated first. The sslip.io hostname is that address with the dots turned into dashes, so the address has to exist before the site is configured, and it has to survive a stop/start.
- Caddy is the only process on 80 and 443. It asks Let's Encrypt for that hostname and keeps the certificate in a volume.
- The instance role is how the box talks to AWS. No access key is written on the machine. Receipts uses that for pulling an image; JTAS uses it for the backup bucket.
- An Elastic IP that is allocated and not attached is billed by the hour. Release it if you tear the instance down.

Not copied, on purpose: receipts launches Amazon Linux from user-data and has no SSH. JTAS is a git checkout and a compose stack, so this is Ubuntu 24.04 and SSH is open from your IP only. Receipts also has no database backup.

## Shape

Use **t3.small** (2 vCPU, 2 GB). The Next.js image is built on the Mac and pulled, the same way receipts runs. Do not build it on this box, and do not use `t3.micro`. `c7i-flex.large` would also launch, at about $62 a month for the instance alone, which spends the credits at the same time the Free Plan ends.

On-demand Linux prices in ap-south-1, list price, 730 hours:

| | Hour | Month | Plus a 30 GB gp3 volume |
| --- | --- | --- | --- |
| t3.small | $0.0224 | $16.35 | about $19 |
| t3.medium | $0.0448 | $32.70 | about $35.50 |

gp3 in Mumbai is $0.0912 per GB-month, so 30 GB is about $2.74. A public IPv4 address is about $0.005 an hour (about $3.60 a month) whether or not it is an Elastic IP. The small box, the disk and the address are about $23 before the receipts instance.

## 1. Budget alert, before the instance

1. Console region does not matter for this. Open **Billing and Cost Management → Budgets → Create budget**.
2. Choose **Customize**, then **Cost budget**.
3. Name `monthly-40`. Period **Monthly**. Budget amount **40** USD. Start this month.
4. Alert at **80% of actual** cost, and another at **100% of forecasted** cost. Send both to your email.
5. Confirm the email AWS sends.

## 2. Backup bucket and instance role

Still before the instance, so the role exists when you launch.

1. Region **Asia Pacific (Mumbai) ap-south-1**.
2. **S3 → Create bucket**. Name `jtas-backups`. Block all public access: on. Versioning: off. Create.
3. On that bucket, **Management → Lifecycle rules → Create**. Name `expire-30-days`. Apply to all objects. Expire current versions after **30** days. The backup container deletes old dumps too; this rule still deletes them if the container is stopped.
4. **IAM → Policies → Create policy → JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::jtas-backups"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::jtas-backups/*"
    }
  ]
}
```

Name it `jtas-backups`.

5. **IAM → Roles → Create role**. Trusted entity **AWS service**, use case **EC2**. Attach `jtas-backups`. Name the role `jtas-ec2`.

## 3. Launch the instance

Stay in **ap-south-1**.

1. **EC2 → Key pairs → Create**. Name `jtas`. Type RSA, format `.pem`. Download it. You only get it once. `chmod 400 jtas.pem` on your laptop.
2. **EC2 → Launch instance**.
3. Name: `jtas`.
4. AMI: **Ubuntu Server 24.04 LTS**. Architecture **64-bit (x86)**. Not the ARM image.
5. Instance type: **t3.small**.
6. Key pair: `jtas`.
7. Network: the default VPC is fine. **Auto-assign public IP: Disable.** The Elastic IP from the next section is the address that matters. A second public address is another $0.005 an hour and it is the one that would change on stop/start.
8. **Create security group** named `jtas`:

   | Type | Port | Source |
   | --- | --- | --- |
   | SSH | 22 | My IP |
   | HTTP | 80 | Anywhere IPv4 (`0.0.0.0/0`) |
   | HTTPS | 443 | Anywhere IPv4 (`0.0.0.0/0`) |

   Do not add 5432, 6379, 9000 or 9001. Port 80 has to stay open: that is where Let's Encrypt's challenge arrives, which is why receipts leaves it open too.

9. Storage: **30 GB gp3**. Leave the default 3000 IOPS and 125 MB/s. Those are included in the price.
10. Advanced details → **IAM instance profile**: `jtas-ec2`.
11. Advanced details → Metadata. Version **V2 only**. **Metadata response hop limit: 2.** Hop limit 1 is the default and it hides the role from Docker. The backup container would then have no credentials, which is the failure this setting exists to avoid.
12. Launch.

## 4. Elastic IP

Do this before you install anything. The hostname is derived from this address, and email links will contain it.

1. **EC2 → Elastic IPs → Allocate**. Region Mumbai. Tag name `jtas`.
2. Select it → **Associate**. Resource type Instance. Pick `jtas`. Private IP is the instance's only one. Allow reassociation: off.
3. Copy the address. `13.232.84.149` becomes `13-232-84-149.sslip.io`. `files.` in front of that name resolves to the same address; attachment uploads use it.
4. From your laptop: `dig +short 13-232-84-149.sslip.io` must print that Elastic IP.

An Elastic IP that is **not** associated with a running instance is billed every hour. If you terminate the instance, release the address on the same screen. Do not allocate a second one "just in case".

Stopping the instance does not change an associated Elastic IP. That is why it is attached now, before the first certificate and before any mail goes out.

## 5. Firewall on the VM

```bash
ssh -i jtas.pem ubuntu@<elastic-ip>
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

The security group and ufw are both required. The group is the one receipts relies on; ufw is the second door on Ubuntu.

## 6. Docker, the repo, secrets

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and SSH back in.

```bash
sudo mkdir -p /opt/jtas
sudo chown "$USER" /opt/jtas
git clone git@github.com:nandeshkanagaraju/jtas.git /opt/jtas
cd /opt/jtas
cp deploy/server.env.example .env
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 32
```

Edit `.env`. Set `JTAS_DOMAIN` and `JTAS_FILES_DOMAIN` from the Elastic IP. Put the two `openssl` values into `JWT_SECRET` and `REFRESH_SECRET` — new ones, not the laptop's. `APP_BASE_URL` is not a line in the file. Compose sets it to `https://${JTAS_DOMAIN}`, which is what links inside email use.

`chmod 600 .env`. `scripts/deploy.sh` exits if this file contains `localhost`, the Colima docker context, or an AWS secret key.

Copy `BREVO_API_KEY` from the laptop `.env`. Also set:

```bash
MAIL_PROVIDER=brevo
MAIL_FROM=nandeshjeyalakshmi@gmail.com
MAIL_FROM_NAME=JTAS
MAIL_ALLOWLIST=nandeshjeyalakshmi@gmail.com,nandeshkanagaraju08@gmail.com
MAIL_DAILY_CAP=250
SEED_MD_EMAIL=nandeshjeyalakshmi@gmail.com
SEED_MEMBER_EMAIL=nandeshkanagaraju08@gmail.com
```

`SEED_*` in `.env` is not read by a normal production seed, and compose does not pass those two variables into the app container. The demo seed has to pass them on this one command, with `--allow-email-overrides`. Without the flag the MD is `md@jaraaglobal.com`, which is not on the allowlist and will never receive mail. After the first `./scripts/deploy.sh`:

```bash
docker compose -f docker-compose.prod.yml --env-file .env run --rm --no-deps \
  -e SEED_MD_EMAIL=nandeshjeyalakshmi@gmail.com \
  -e SEED_MEMBER_EMAIL=nandeshkanagaraju08@gmail.com \
  app node_modules/.bin/tsx prisma/seed.ts --allow-email-overrides
```

That prints ten one-time passwords once. It creates departments and those accounts, and no jobs. Do not run `pnpm seed:demo` or `pnpm seed:showcase`. A later seed without the flag still refuses the Gmail addresses.

## 7. Release

The app image is built on the Mac and stored as a private package at `ghcr.io/nandeshkanagaraju/jtas`. The server pulls that image. It still builds the backup image itself. Do this in order, every release.

### On the Mac, after `main` has the commit you want to run

Create a GitHub token with **write:packages** and keep it on the Mac. Do not put it in the server `.env` or in the image. Log in once:

```bash
docker login ghcr.io -u nandeshkanagaraju
```

From a clean checkout of that commit:

```bash
SHA="$(git rev-parse --short HEAD)"
docker buildx build --platform linux/amd64 \
  -t "ghcr.io/nandeshkanagaraju/jtas:${SHA}" \
  --push .
docker buildx imagetools inspect "ghcr.io/nandeshkanagaraju/jtas:${SHA}"
```

The inspect line prints the manifest digest, `sha256:…`. The first push creates the package. In GitHub, open the package and leave the visibility **Private**.

`NEXT_PUBLIC_SENTRY_DSN` is baked in at build time. Pass `--build-arg NEXT_PUBLIC_SENTRY_DSN=…` on that command when you want client-side Sentry. The server `SENTRY_DSN` is read at runtime and is not in the image.

### On the server, before `./scripts/deploy.sh`

Create a second GitHub token with only **read:packages**. Put it in `/opt/jtas/.env`:

```bash
GHCR_USER=nandeshkanagaraju
GHCR_PULL_TOKEN=the-read-only-token
JTAS_IMAGE=ghcr.io/nandeshkanagaraju/jtas:THE_SHORT_SHA
```

`chmod 600 .env`. Compose does not pass `GHCR_PULL_TOKEN` into the app or the worker. `scripts/deploy.sh` uses it for `docker login` on the host, then pulls `JTAS_IMAGE`.

### On the server, the deploy

```bash
cd /opt/jtas
./scripts/deploy.sh
```

It pulls `main`, logs in to GHCR, pulls the app image, builds the backup image, runs `prisma migrate deploy`, then recreates the app and the worker. Caddy, the database, Redis, MinIO and the backup sidecar come up with it. `restart: unless-stopped` is set on all of them, so a reboot brings the worker back.

The script writes the running image's registry digest to `.deploy/current-image`, and the one it replaced to `.deploy/previous-image`. Those files are gitignored.

## 8. Confirm the worker

```bash
curl -s https://13-232-84-149.sslip.io/api/health
docker compose -f docker-compose.prod.yml --env-file .env ps
```

`dbOk` and `redisOk` should be true, and the HTTP status 200. `schedulerHeartbeatAgeSeconds` is `null` until the worker finishes its first pass (every 5 minutes). After that it should be a number under `1200`. `null` after ten minutes, or a 503 with a large age, means the worker is not running.

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs --tail 50 worker
```

Sign in over HTTPS and check the certificate is Let's Encrypt for the sslip.io name.

## 9. Prove a backup

The backup container uploads a dump on start, then daily at 01:00 IST. Watch the first one:

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f backup
```

You want `uploaded jtas-….sql.gz` and no line about access keys. Then, on this VM:

```bash
docker compose -f docker-compose.prod.yml --env-file .env run --rm --no-deps \
  --entrypoint /bin/sh backup /usr/local/bin/restore-proof.sh
```

The last line must be `PASS`. That command loads the dump into a scratch database and drops it. It does not touch the live database. Run it once before calling the deploy finished.

## 10. Logs

```bash
docker compose -f docker-compose.prod.yml --env-file .env logs -f app
docker compose -f docker-compose.prod.yml --env-file .env logs -f worker
docker compose -f docker-compose.prod.yml --env-file .env logs -f caddy
docker compose -f docker-compose.prod.yml --env-file .env logs -f backup
```

Caddy's access log is in the `jtas-caddy-logs` volume at `/var/log/caddy/access.log`.

## 11. Roll back

```bash
./scripts/deploy.sh --rollback
```

That reads `.deploy/previous-image` and pulls that exact image, for example:

```bash
docker pull ghcr.io/nandeshkanagaraju/jtas@sha256:PASTE_THE_DIGEST_FROM_.deploy/previous-image
```

The script does the pull itself, then recreates the app and the worker with `JTAS_IMAGE` set to that digest for this run. It does not `git pull`, does not build, and does not run migrations. A bad migration is a restore from S3, not a rollback. There is no previous digest until the second release.

## 12. Swap in jtas.jaraaglobal.com later

1. Two A records, both aimed at the **Elastic IP** (not whatever address `dig` shows if you ever detach it):

   - `jtas.jaraaglobal.com`
   - `files.jaraaglobal.com`

2. In `Caddyfile`, the site block is the line `{$JTAS_DOMAIN}` and the files block is `{$JTAS_FILES_DOMAIN}`. Replace those with:

   ```caddyfile
   jtas.jaraaglobal.com {
   ```

   and

   ```caddyfile
   files.jaraaglobal.com {
   ```

3. The same names in `.env`, or email links stay on sslip.io:

   ```bash
   JTAS_DOMAIN=jtas.jaraaglobal.com
   JTAS_FILES_DOMAIN=files.jaraaglobal.com
   ```

4. `./scripts/deploy.sh`. Leave 80 and 443 open so the new certificates can be issued.

Moving the whole stack off AWS later is the same compose file on any other Linux host, plus a new `.env` and a new A record. That is an afternoon, which matters because of the date below.

## 13. What the credits actually cover

Two clocks:

- The **$148 credit balance expires 25 May 2027**.
- The **Free Plan window closes 26 November 2026**. This is the one that matters. After that date a Free Plan account does not keep running paid services on leftover credits the way a paid account does. Before 26 November, either move this compose file to a cheap VPS or switch the account to a paid plan.

What keeps billing while the credits last:

- The instance, every hour it exists, including when it is doing nothing.
- The 30 GB gp3 volume, including if you stop the instance. Stopped does not mean free. Terminating the instance without deleting the volume leaves the disk billing.
- The public IPv4 address, about $0.005 an hour.
- An **unattached** Elastic IP, every hour, and it is easy to forget after a terminate. Release it.
- Data transferred out to the internet. Mumbai is about $0.109 per GB after the monthly free allowance. Mail and a handful of users will not show up. A public attachment bucket would.
- S3 storage for the dumps. A lifecycle rule of 30 days keeps this near zero.

What does not need to bill: NAT gateways, load balancers, extra Elastic IPs, a second instance "for staging". Do not create them.
