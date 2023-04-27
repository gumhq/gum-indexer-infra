import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as docker from "@pulumi/docker";

// Get the GCP project and region from the configuration.
const config = new pulumi.Config("gcp");
const project = config.require("project") || gcp.config.project;
const region = config.require("region") || "us-central1";

const gumIndexerConfig = new pulumi.Config("gum-indexer");
const dbPassword = gumIndexerConfig.requireSecret("dbPassword");
const gcpServiceAccountKey = gumIndexerConfig.requireSecret("gcpServiceAccountKey");

const POSTGRES_DB_NAME = "gum";

// Create a VPC network for the infrastructure.
const network = new gcp.compute.Network("network", {
  project: project,
});

const subnetwork = new gcp.compute.Subnetwork("subnetwork", {
  project: project,
  region: region,
  network: network.id,
  ipCidrRange: "10.0.0.0/24",
});


// Create a firewall rule to allow traffic on port 8080.
const allow8080 = new gcp.compute.Firewall("allow8080", {
  project: project,
  network: network.id,
  allows: [
    {
      protocol: "tcp",
      ports: ["8080"],
    },
  ],
  sourceRanges: ["0.0.0.0/0"],
});

// Create a firewall rule to allow SSH traffic on port 22.
const allowSSH = new gcp.compute.Firewall("allowssh", {
  project: project,
  network: network.id,
  allows: [
    {
      protocol: "tcp",
      ports: ["22"],
    },
  ],
  sourceRanges: ["0.0.0.0/0"],
});


// Build and push the Docker image to Google Container Registry.
const imageName = "gum-redis-server";
const redisImage = new docker.Image(imageName, {
  imageName: pulumi.interpolate`us.gcr.io/${project}/${imageName}:latest`,
  build: {
    context: "../",
    cacheFrom: {
      images: ["us.gcr.io/ace-scarab-384410/gum-redis-server"],
    },
    platform: "linux/amd64",
  },
  registry: {
    server: "us.gcr.io",
    username: "_json_key",
    password: gcpServiceAccountKey,
  },
  // Set the access control for the image to public-read
});


// Create a PostgreSQL instance.
const postgres = new gcp.sql.DatabaseInstance("postgres", {
  project: project,
  region: region,
  settings: {
    tier: "db-f1-micro",
    ipConfiguration: {
      ipv4Enabled: true,
    },
    databaseFlags: [
      {
        name: "cloudsql.iam_authentication",
        value: "on",
      },
    ],
    backupConfiguration: {
      enabled: true,
    },
    locationPreference: {
      zone: region + "-a",
    },
  },
  databaseVersion: "POSTGRES_14",
});

const postgresDB = new gcp.sql.Database("postgres-db", {
  project: project,
  instance: postgres.name,
  name: POSTGRES_DB_NAME,
});

const postgresUser = new gcp.sql.User("postgres-user", {
  project: project,
  instance: postgres.name,
  name: "gumuser",
  password: dbPassword,
});

const serviceAccount = new gcp.serviceaccount.Account("gum-redis-server-sa", {
  accountId: "gum-redis-server-sa",
  displayName: "Gum Redis Server Service Account",
});

if (!project) throw new Error("Missing required project configuration value");

const logWriterRoleBinding = new gcp.projects.IAMBinding("logWriterRoleBinding", {
  project: project,
  role: "roles/logging.logWriter",
  members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
});

const serviceAccountKey = new gcp.serviceaccount.Key("gum-redis-server-sa-key", {
  serviceAccountId: serviceAccount.id,
});

// Create a Compute Engine instance with a custom startup script.
const instance = new gcp.compute.Instance("instance", {
  project: project,
  zone: region + "-a",
  machineType: "n1-standard-1",
  networkInterfaces: [
    {
      network: network.id,
      accessConfigs: [{}],
    },
  ],
  bootDisk: {
    initializeParams: {
      image: "ubuntu-os-cloud/ubuntu-2004-lts",
    },
  },
  serviceAccount: {
    email: serviceAccount.email,
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
    ],
  },
  allowStoppingForUpdate: true,
  metadataStartupScript: pulumi.all([redisImage.imageName, postgres.connectionName, postgresUser.name, postgresUser.password]).apply(([image, connection, user, pass]) => `
    #!/bin/bash
    exec > >(tee /var/log/startup.log)
    exec 2>&1
    set -x

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io

    echo '${gcpServiceAccountKey}' > /tmp/keyfile.json
    gcloud auth activate-service-account --key-file=/tmp/keyfile.json
    gcloud auth configure-docker us.gcr.io

    docker pull ${image}
    docker run -d --name app -p 8080:8080 --restart always --log-driver gcplogs --log-opt gcp-log-cmd=true -e POSTGRES_CONNECTION_NAME=${connection} -e POSTGRES_USER=${user} -e POSTGRES_PASSWORD=${pass} -e POSTGRES_DB_NAME=${POSTGRES_DB_NAME} ${image}
  `),
});


// Export the instance's external IP.
export const instanceExternalIp = instance.networkInterfaces.apply(nis => nis[0].accessConfigs?.[0].natIp);
