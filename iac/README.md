# Deploying the Gum Indexer Infrastructure to GCP with Pulumi

The infrastructure for this project is built using Pulumi, which creates the following resources in Google Cloud Platform:

- VPC network
- Subnetwork
- Firewall rules
- Docker image built from the local directory
- PostgreSQL instances for Devnet and Mainnet
- Compute Engine instances for running the Gum Indexer
- Hasura Cloud Run services for Devnet and Mainnet

## Prerequisites

- Install [Node.js](https://nodejs.org/en/download/) (version 14.x or later)
- Install [Docker](https://docs.docker.com/get-docker/)
- Install [Pulumi](https://www.pulumi.com/docs/get-started/install/)
- Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)

## Configuration

1.  Create a new project in the [Google Cloud Console](https://console.cloud.google.com/).

2.  Set up the GCP project and region:

    ```
    gcloud config set project <project-id>
    gcloud config set compute/region <region>
    pulumi config set gcp:project YOUR_PROJECT_ID
    pulumi config set gcp:region YOUR_REGION
    ```

3.  Create a service account and download the JSON key file

4.  Set up the Gum Indexer-specific configurations:

    ```
    pulumi config set gum-indexer:dbPassword YOUR_POSTGRES_DEVNET_PASSWORD --secret
    pulumi config set gum-indexer:postgresMainnetPassword YOUR_POSTGRES_MAINNET_PASSWORD --secret
    pulumi config set gum-indexer:gcpServiceAccountKey `cat path/to/service-account-key.json` --secret
    pulumi config set gum-indexer:hasuraAdminSecret YOUR_HASURA_ADMIN_SECRET --secret
    ```

    Replace the placeholders with your actual configuration values. The --secret flag ensures that sensitive values are encrypted.

## Deployment

1. Install dependencies:

   ```
   npm install
   ```

2. Deploy the stack:

   ```
    pulumi up
   ```
