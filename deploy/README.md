# Deploying Agent Studio to Google Cloud

Everything runs from **Cloud Shell**, the terminal in the Google Cloud console, which already has `gcloud` installed and signed in. You never need Docker or Node on your own machine.

## What gets created

| Piece | Google Cloud service | Notes |
|---|---|---|
| The app (web + scheduler) | Cloud Run service `agent-studio` | One container runs the Next.js app and the scheduler, which ticks `/api/cron` on `127.0.0.1` every minute |
| Database | Cloud SQL for PostgreSQL 16, instance `agent-studio-db` | Daily backups, point-in-time recovery, deletion protection |
| Uploaded and generated files | Cloud Storage bucket `<project>-agent-studio-files` | Mounted into the container at `/data/storage` |
| Secrets | Secret Manager: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AUTH_SECRET`, `CRON_SECRET` | Generated for you, except the Anthropic key, which you are asked for |
| Container image | Artifact Registry repository `agent-studio` | Built by Cloud Build from the `Dockerfile` |
| Schema updates | Cloud Run job `agent-studio-migrate` | Runs `db/schema.sql` (idempotent) before each deploy |
| Access control | Identity-Aware Proxy (IAP) | Only the people or groups you list can reach the app |

## Before you start

- A Google Cloud project with **billing enabled**.
- Your **Anthropic API key**.
- Know **who should have access**: your company domain, a Google group, or individual emails.
- Enough permissions. Either you are **Owner** of the project, or you have the roles below and a project admin runs one file for you (see next section).

| You (the person deploying) need | For |
|---|---|
| Service Usage Admin | enabling APIs |
| Artifact Registry Admin | the image repository |
| Cloud Build Editor | building the image |
| Cloud SQL Admin | the database |
| Storage Admin | the bucket |
| Secret Manager Admin | the secrets |
| Cloud Run Admin | the service and the schema job |
| Service Account Admin | creating the app's service account (or let the admin do it) |

To see which roles you have:

```bash
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --flatten=bindings --filter="bindings.members:user:$(gcloud config get-value account)" \
  --format="value(bindings.role)"
```

## If you are not allowed to change IAM

In company-managed projects, changing permissions (IAM) is usually reserved for admins. The scripts handle that: whenever a permission change is refused, they carry on with everything else and write the exact command to a file for that step: **`deploy/admin-grants-step1.sh`**, `-step2.sh` or `-step3.sh`. At the end they tell you which.

1. Print the file (for example `cat deploy/admin-grants-step1.sh`) and send it to your GCP project admin.
2. They run it once in Cloud Shell: `bash admin-grants-step1.sh`.
3. You re-run the same step. It skips everything that already exists and finishes.

This can happen at step 3 (creating the resources), at step 5 (turning on IAP and granting access) and, rarely, at step 4 (letting Cloud SQL read the dump from the bucket). Before asking, step 3 checks the project's IAM policy and skips any role an account already has, directly or through Editor/Owner.

### Running as an existing service account instead

If your other Cloud Run apps already run as a service account that can reach Cloud SQL and Secret Manager (typically the **Compute default account**, `<project-number>-compute@developer.gserviceaccount.com`), Agent Studio can run as it too, and step 3 then needs no admin at all. Add this to `deploy/config.sh`:

```bash
RUNTIME_SA_EMAIL="<project-number>-compute@developer.gserviceaccount.com"
```

The trade-off: that account usually has **Editor on the whole project**, so the app runs with far more access than it needs, shared with every other app using the same account. The dedicated `agent-studio-run` account gets only what Agent Studio needs. Fine for a pilot behind IAP; for production, switch to the dedicated account once an admin has granted it access (clear the line and re-run steps 3 and 5).

**Editor cannot read Secret Manager secrets.** Reading a secret's value needs the separate *Secret Manager Secret Accessor* role. If step 5 fails with `Permission denied on secret`, either an admin grants that role on the four secrets, or you pass the values as plain environment variables, the way `--env-vars-file` deployments do:

```bash
echo 'SECRETS_MODE="env"' >> deploy/config.sh
```

In that mode the values live in `~/.agent-studio-<project>.env` in your Cloud Shell (private to you, outside the project folder). Values that cannot be read back from Secret Manager are regenerated, including a new database password, and the Anthropic key is asked for again. Anyone who can view the Cloud Run service can see environment variables, so prefer Secret Manager once an admin can grant access.

To redeploy an image that is already built (for example after a failed deploy) without building again:

```bash
IMAGE_TAG=<tag printed by the build> bash deploy/3-deploy-app.sh
```

## Step 1: Upload and unzip

1. Open <https://console.cloud.google.com>, select your project, and click the **Activate Cloud Shell** icon (`>_`, top right).
2. In the Cloud Shell toolbar, click **⋮ (More) → Upload**, and choose `agent-studio-gcp.zip`.
3. Run:

```bash
unzip -q agent-studio-gcp.zip -d agent-studio
cd agent-studio
```

## Step 2: Fill in the settings

```bash
nano deploy/config.sh
```

Set these three values at the top, then save with `Ctrl+O`, `Enter`, and exit with `Ctrl+X`:

| Setting | Example |
|---|---|
| `PROJECT_ID` | `my-agent-studio-prod` (the project **id**, shown on the console home page) |
| `REGION` | `asia-south1` (Mumbai) |
| `IAP_MEMBERS` | `domain:yourcompany.com` or `group:ai-team@yourcompany.com,user:you@yourcompany.com` |

## Step 3: Create the cloud resources (about 15 minutes, once)

```bash
bash deploy/1-setup-infra.sh
```

It enables the APIs and creates the registry, service account, bucket, Cloud SQL instance, database and secrets. Near the end it asks you to **paste your Anthropic API key** (the input is hidden).

Safe to re-run: anything that already exists is left alone.

> **Saved connections from the old install.** Connection credentials in the database are encrypted with the old install's `AUTH_SECRET`. To keep them working, run this step as `AUTH_SECRET='<that value>' bash deploy/1-setup-infra.sh` the first time. Otherwise the app works, but those connections must be re-entered.

## Step 4: Load the existing data (about 5 minutes, once)

```bash
bash deploy/2-import-data.sh
```

This loads `deploy/data/agent_studio_backup.sql` (the agents, versions, skills, apps, runs, users and audit history) into Cloud SQL. You are asked to type `import` to confirm, because it replaces whatever is in the cloud database.

It refuses to run a second time, so a later mistake cannot wipe live data. `FORCE=1 bash deploy/2-import-data.sh` overrides that.

To start with an empty database instead, skip this step. Then open the app and choose **Create a workspace**.

## Step 5: Build and deploy the app (about 10 minutes)

```bash
bash deploy/3-deploy-app.sh
```

It builds the image with Cloud Build, updates the schema, deploys the Cloud Run service, turns on IAP and grants access to `IAP_MEMBERS`. At the end it prints the app's address, like:

```
https://agent-studio-123456789012.asia-south1.run.app
```

## Step 6: Open the app

1. Open the printed address.
2. **First**, Google asks you to sign in (that is IAP). Use an account that is in `IAP_MEMBERS`.
3. **Then** the Agent Studio login page appears. Sign in with your Agent Studio email and password; the users and passwords from the imported data carry over unchanged.

IAP access can take a minute or two to apply after the first deploy. If you see "You don't have access", wait and reload.

## Updating the app later

Upload the new zip, unzip it over the old folder (keep your edited `deploy/config.sh`), and run:

```bash
bash deploy/3-deploy-app.sh
```

Data, secrets and settings are kept. Each deploy is a new Cloud Run revision; to roll back, open **Cloud Run → agent-studio → Revisions** and send traffic to the previous one.

## Everyday commands

```bash
# Recent logs
gcloud run services logs read agent-studio --region asia-south1 --limit 100

# Give another person or group access
gcloud beta iap web add-iam-policy-binding --resource-type=cloud-run \
  --service=agent-studio --region=asia-south1 \
  --member=user:someone@yourcompany.com --role=roles/iap.httpsResourceAccessor

# Change the Anthropic key (the next deploy or restart picks it up)
printf '%s' 'sk-ant-...' | gcloud secrets versions add ANTHROPIC_API_KEY --data-file=-
gcloud run services update agent-studio --region asia-south1 --update-labels=restarted=$(date +%s)

# Connect to the database with psql
gcloud sql connect agent-studio-db --user=postgres --database=agent_studio
```

## Troubleshooting

**Cloud Build fails with a permission error.** Some organisations restrict the default build service account. Re-run `bash deploy/1-setup-infra.sh` (it grants the needed roles), wait two minutes, then retry step 5.

**IAP could not be enabled.** IAP on Cloud Run needs the project to belong to a Google Cloud organisation, and the people you grant access to must be in it (or in its allowed domains). If your project is a personal one with no organisation:
- use a project inside your company's organisation, **or**
- set `ACCESS_MODE="public"` in `deploy/config.sh` and re-run step 5. Read **Security** below first.

**"Error: Forbidden" or 403 in the browser.** Your account is not in `IAP_MEMBERS`, or access has not applied yet (wait two minutes).

**The app loads but says the database is unreachable.** Check the logs. The usual cause is that the import or schema job failed; re-run step 5, which re-runs the schema job.

**Scheduled agents do not fire.** They need `MIN_INSTANCES=1` (the default), because the scheduler lives inside the running container.

## Security

This deploys the application **as it is today**. `docs/PRODUCTION_READINESS_REVIEW.md` lists issues that make the app unsafe to expose to the open internet, including routes that do not check who is calling. With `ACCESS_MODE="iap"` (the default), only the people you list can reach the app at all, which contains those issues to trusted internal users. **Do not switch to `public` for anything beyond a short test** until the critical items in that review are fixed.

Other notes:
- The database password, `AUTH_SECRET` and `CRON_SECRET` are random values generated in Secret Manager. Nobody needs to know them.
- **Never re-create `AUTH_SECRET`** once connections have been saved. It encrypts their credentials, and a new value makes them undecryptable.
- `deploy/data/agent_studio_backup.sql` contains user records (password hashes) and encrypted credentials. Delete it from Cloud Shell once the import is done: `rm deploy/data/agent_studio_backup.sql`.

## Cost

Roughly, before any free-tier credit:
- **Cloud Run:** one always-on instance (1 vCPU, 1 GiB), kept on so the scheduler runs.
- **Cloud SQL:** `db-g1-small` with 10 GB SSD and backups.
- **Everything else:** storage, Artifact Registry and Secret Manager, which cost little at this scale.
- **Anthropic API usage:** billed by Anthropic, separately.

Check current prices in the [Google Cloud pricing calculator](https://cloud.google.com/products/calculator) for your region. To stop Cloud Run charges when idle, set `MIN_INSTANCES=0`; scheduled agents then stop firing.

## Removing everything

```bash
gcloud run services delete agent-studio --region asia-south1
gcloud run jobs delete agent-studio-migrate --region asia-south1
gcloud sql instances patch agent-studio-db --no-deletion-protection
gcloud sql instances delete agent-studio-db
gcloud storage rm -r gs://$(gcloud config get-value project)-agent-studio-files
gcloud artifacts repositories delete agent-studio --location asia-south1
for s in DATABASE_URL ANTHROPIC_API_KEY AUTH_SECRET CRON_SECRET; do gcloud secrets delete $s; done
```

Deleting the Cloud SQL instance deletes its backups too. Export the database first if you may need it.
