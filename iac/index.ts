import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as docker from "@pulumi/docker";
const axios = require("axios");

const APP_NAME = "gum-indexer";

// Get the GCP project and region from the configuration.
const config = new pulumi.Config("gcp");
const project = config.require("project") || gcp.config.project;
const region = config.require("region") || "us-central1";

const gumIndexerConfig = new pulumi.Config("gum-indexer");
const mainnetRpcUrl = gumIndexerConfig.require("mainnetRpcUrl");
const devnetRpcUrl = gumIndexerConfig.require("devnetRpcUrl");
const dbPassword = gumIndexerConfig.requireSecret("dbPassword"); // This is Postgres Devnet DB Password
const postgresMainnetPassword = gumIndexerConfig.requireSecret("postgresMainnetPassword");
const gcpServiceAccountKey = gumIndexerConfig.requireSecret("gcpServiceAccountKey");
const hasuraAdminSecret = gumIndexerConfig.requireSecret("hasuraAdminSecret");

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
  targetTags: ["devnet-instance", "mainnet-instance"],
});

// Create a firewall rule to allow traffic on port 8081.
const allow8081 = new gcp.compute.Firewall("allow8081", {
  project: project,
  network: network.id,
  allows: [
    {
      protocol: "tcp",
      ports: ["8081"],
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
  skipPush: false,
  registry: {
    server: "us.gcr.io",
    username: "_json_key",
    password: gcpServiceAccountKey,
  },
  // Set the access control for the image to public-read
});


// Create a PostgreSQL instance.
const postgresDevnet = new gcp.sql.DatabaseInstance(`${APP_NAME}-devnet`, {
  project: project,
  region: region,
  settings: {
    tier: "db-f1-micro",
    ipConfiguration: {
      ipv4Enabled: true,
      authorizedNetworks: [
        {
          value: "0.0.0.0/0",
        },
      ],
    },
    databaseFlags: [
      {
        name: "cloudsql.iam_authentication",
        value: "off",
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

// Export the PostgreSQL instance's external IP.
export const postgresDevnetExternalIp = postgresDevnet.publicIpAddress;

// Export the PostgreSQL instance's port.
export const postgresDevnetPort = 5432;

// Create a PostgreSQL database and user.
const postgresDevnetDB = new gcp.sql.Database(`${APP_NAME}-devnet-db`, {
  project: project,
  instance: postgresDevnet.name,
  name: POSTGRES_DB_NAME,
});

const postgresDevnetUser = new gcp.sql.User(`${APP_NAME}-devnet-user`, {
  project: project,
  instance: postgresDevnet.name,
  name: "gumuser",
  password: dbPassword,
});

const postgresMainnet = new gcp.sql.DatabaseInstance(`${APP_NAME}-mainnet`, {
  project: project,
  region: region,
  settings: {
    tier: "db-f1-micro",
    ipConfiguration: {
      ipv4Enabled: true,
      authorizedNetworks: [
        {
          value: "0.0.0.0/0",
        },
      ],
    },
    databaseFlags: [
      {
        name: "cloudsql.iam_authentication",
        value: "off",
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

// Export the PostgreSQL instance's external IP.
export const postgresMainnetExternalIp = postgresMainnet.publicIpAddress;

// Export the PostgreSQL instance's port.
export const postgresMainnetPort = 5432;

// Create a PostgreSQL database and user.
const postgresMainnetDB = new gcp.sql.Database(`${APP_NAME}-mainnet-db`, {
  project: project,
  instance: postgresMainnet.name,
  name: POSTGRES_DB_NAME,
});

const postgresMainnetUser = new gcp.sql.User(`${APP_NAME}-mainnet-user`, {
  project: project,
  instance: postgresMainnet.name,
  name: "gumuser",
  password: postgresMainnetPassword,
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
const instanceSmartProfileDevnet = new gcp.compute.Instance(`${APP_NAME}-devnet-smartprofile-instance`, {
  name: `${APP_NAME}-devnet-instance`,
  project: project,
  zone: region + "-a",
  machineType: "n1-standard-1",
  tags: ["devnet-instance"],
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
  metadataStartupScript: pulumi.all([redisImage.imageName, postgresDevnetExternalIp, postgresDevnetUser.name, postgresDevnetUser.password, devnetRpcUrl]).apply(([image, host, user, pass, rpcUrl]) => `
    #!/bin/bash
    exec > >(tee /var/log/startup.log)
    exec 2>&1
    set -x

    # Version 6

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io

    docker pull ${image}
    docker run -d --name app -p 8080:8080 -p 8081:8081 --restart always --log-driver gcplogs --log-opt gcp-log-cmd=true \
    -e CLUSTER="devnet" -e POSTGRES_HOST=${host} \
    -e POSTGRES_USER=${user} -e POSTGRES_PASSWORD=${pass} -e POSTGRES_DB_NAME=${POSTGRES_DB_NAME} -e DEVNET_RPC_URL=${rpcUrl} ${image}
  `),
});

const instanceSmartProfileMainnet = new gcp.compute.Instance(`${APP_NAME}-mainnet-smartprofile-instance`, {
  name: `${APP_NAME}-mainnet-instance`,
  project: project,
  zone: region + "-a",
  machineType: "n1-standard-1",
  tags: ["mainnet-instance"],
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
  metadataStartupScript: pulumi.all([redisImage.imageName, postgresMainnetExternalIp, postgresMainnetUser.name, postgresMainnetUser.password, mainnetRpcUrl]).apply(([image, host, user, pass, rpcUrl]) => `
    #!/bin/bash
    exec > >(tee /var/log/startup.log)
    exec 2>&1
    set -x

    # Version 4

    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io

    docker pull ${image}
    docker run -d --name app -p 8080:8080 -p 8081:8081 --restart always --log-driver gcplogs --log-opt gcp-log-cmd=true \
     -e CLUSTER="mainnet-beta" -e POSTGRES_HOST=${host} \
     -e POSTGRES_USER=${user} -e POSTGRES_PASSWORD=${pass} -e POSTGRES_DB_NAME=${POSTGRES_DB_NAME} -e MAINNET_RPC_URL=${rpcUrl} ${image}
  `),
});

const hasuraImageName = "gum-hasura";
const hasuraImage = new docker.Image(hasuraImageName, {
  imageName: pulumi.interpolate`us.gcr.io/${project}/${hasuraImageName}:latest`,
  build: {
    context: "./hasura",
  },
  skipPush: false,
  registry: {
    server: "us.gcr.io",
    username: "_json_key",
    password: gcpServiceAccountKey,
  },
});

const hasuraServiceDevnet = new gcp.cloudrun.Service(`${APP_NAME}-devnet-service`, {
  name: `${APP_NAME}-devnet`,
  location: region,
  template: {
    spec: {
      containers: [
        {
          image: hasuraImage.imageName,
          envs: [
            {
              name: "HASURA_GRAPHQL_DATABASE_URL",
              value: pulumi.all([postgresDevnetUser.name, postgresDevnetUser.password, postgresDevnetExternalIp]).apply(([user, pass, ip]) => `postgres://${user}:${pass}@${ip}:${postgresDevnetPort}/${POSTGRES_DB_NAME}`),
            },
            {
              name: "HASURA_GRAPHQL_ENABLE_CONSOLE",
              value: "true",
            },
            {
              name: "HASURA_GRAPHQL_ADMIN_SECRET",
              value: hasuraAdminSecret,
            },
            {
              name: "HASURA_GRAPHQL_UNAUTHORIZED_ROLE",
              value: "public",
            }
          ],
        }
      ],
    },
  },
  autogenerateRevisionName: true,
  traffics: [
    {
      percent: 100,
      latestRevision: true,
    },
  ],
});

const hasuraServiceSmartProfileDevnet = new gcp.cloudrun.Service(`${APP_NAME}-smartprofile-devnet-service`, {
  name: `${APP_NAME}-smartprofile-devnet`,
  location: region,
  template: {
    spec: {
      containers: [
        {
          image: hasuraImage.imageName,
          envs: [
            {
              name: "HASURA_GRAPHQL_DATABASE_URL",
              value: pulumi.all([postgresDevnetUser.name, postgresDevnetUser.password, postgresDevnetExternalIp]).apply(([user, pass, ip]) => `postgres://${user}:${pass}@${ip}:${postgresDevnetPort}/gumcore`),
            },
            {
              name: "HASURA_GRAPHQL_ENABLE_CONSOLE",
              value: "true",
            },
            {
              name: "HASURA_GRAPHQL_ADMIN_SECRET",
              value: hasuraAdminSecret,
            },
            {
              name: "HASURA_GRAPHQL_UNAUTHORIZED_ROLE",
              value: "public",
            }
          ],
        }
      ],
    },
  },
  autogenerateRevisionName: true,
  traffics: [
    {
      percent: 100,
      latestRevision: true,
    },
  ],
});

const hasuraServiceMainnet = new gcp.cloudrun.Service(`${APP_NAME}-mainnet-service`, {
  name: `${APP_NAME}-mainnet`,
  location: region,
  template: {
    spec: {
      containers: [
        {
          image: hasuraImage.imageName,
          envs: [
            {
              name: "HASURA_GRAPHQL_DATABASE_URL",
              value: pulumi.all([postgresMainnetUser.name, postgresMainnetUser.password, postgresMainnetExternalIp]).apply(([user, pass, ip]) => `postgres://${user}:${pass}@${ip}:${postgresMainnetPort}/${POSTGRES_DB_NAME}`),
            },
            {
              name: "HASURA_GRAPHQL_ENABLE_CONSOLE",
              value: "true",
            },
            {
              name: "HASURA_GRAPHQL_ADMIN_SECRET",
              value: hasuraAdminSecret,
            },
            {
              name: "HASURA_GRAPHQL_UNAUTHORIZED_ROLE",
              value: "public",
            }
          ],
        }
      ],
    },
  },
  autogenerateRevisionName: true,
  traffics: [
    {
      percent: 100,
      latestRevision: true,
    },
  ],
});

const hasuraServiceSmartProfileMainnet = new gcp.cloudrun.Service(`${APP_NAME}-smartprofile-mainnet-service`, {
  name: `${APP_NAME}-smartprofile-mainnet`,
  location: region,
  template: {
    spec: {
      containers: [
        {
          image: hasuraImage.imageName,
          envs: [
            {
              name: "HASURA_GRAPHQL_DATABASE_URL",
              value: pulumi.all([postgresMainnetUser.name, postgresMainnetUser.password, postgresMainnetExternalIp]).apply(([user, pass, ip]) => `postgres://${user}:${pass}@${ip}:${postgresMainnetPort}/gumcore`),
            },
            {
              name: "HASURA_GRAPHQL_ENABLE_CONSOLE",
              value: "true",
            },
            {
              name: "HASURA_GRAPHQL_ADMIN_SECRET",
              value: hasuraAdminSecret,
            },
            {
              name: "HASURA_GRAPHQL_UNAUTHORIZED_ROLE",
              value: "public",
            }
          ],
        }
      ],
    },
  },
  autogenerateRevisionName: true,
  traffics: [
    {
      percent: 100,
      latestRevision: true,
    },
  ],
});

// Set the IAM policy for the Cloud Run service to be publicly accessible.
const hasuraIamMemberDevnet = new gcp.cloudrun.IamMember(`${APP_NAME}-devnet-hasura-iam-member`, {
  location: region,
  service: hasuraServiceDevnet.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

// Set the IAM policy for the Cloud Run service to be publicly accessible.
const hasuraIamMemberSmartProfileDevnet = new gcp.cloudrun.IamMember(`${APP_NAME}-smartprofile-devnet-hasura-iam-member`, {
  location: region,
  service: hasuraServiceSmartProfileDevnet.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

const hasuraIamMemberMainnet = new gcp.cloudrun.IamMember(`${APP_NAME}-mainnet-hasura-iam-member`, {
  location: region,
  service: hasuraServiceMainnet.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

const hasuraIamMemberSmartProfileMainnet = new gcp.cloudrun.IamMember(`${APP_NAME}-smartprofile-mainnet-hasura-iam-member`, {
  location: region,
  service: hasuraServiceSmartProfileMainnet.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

// Export the Hasura service URL for old gum program.
export const hasuraDevnetServiceUrl = hasuraServiceDevnet.statuses[0].url;
export const hasuraDevnetAPIUrl = pulumi.interpolate`${hasuraDevnetServiceUrl}/v1/graphql`;
export const hasuraDevnetConsoleUrl = pulumi.interpolate`https://cloud.hasura.io/public/graphiql?endpoint=${hasuraDevnetAPIUrl}`;

export const hasuraMainnetServiceUrl = hasuraServiceMainnet.statuses[0].url;
export const hasuraMainnetAPIUrl = pulumi.interpolate`${hasuraMainnetServiceUrl}/v1/graphql`;
export const hasuraMainnetConsoleUrl = pulumi.interpolate`https://cloud.hasura.io/public/graphiql?endpoint=${hasuraMainnetAPIUrl}`;

// Export the Hasura service URL for smartprofile.
export const hasuraSmartProfileDevnetServiceUrl = hasuraServiceSmartProfileDevnet.statuses[0].url;
export const hasuraSmartProfileDevnetAPIUrl = pulumi.interpolate`${hasuraSmartProfileDevnetServiceUrl}/v1/graphql`;
export const hasuraSmartProfileDevnetConsoleUrl = pulumi.interpolate`https://cloud.hasura.io/public/graphiql?endpoint=${hasuraSmartProfileDevnetAPIUrl}`;

export const hasuraSmartProfileMainnetServiceUrl = hasuraServiceSmartProfileMainnet.statuses[0].url;
export const hasuraSmartProfileMainnetAPIUrl = pulumi.interpolate`${hasuraSmartProfileMainnetServiceUrl}/v1/graphql`;
export const hasuraSmartProfileMainnetConsoleUrl = pulumi.interpolate`https://cloud.hasura.io/public/graphiql?endpoint=${hasuraSmartProfileMainnetAPIUrl}`;

// Export the instance's external IP.
export const instanceDevnetExternalIp = instanceSmartProfileDevnet.networkInterfaces.apply(nis => nis[0].accessConfigs?.[0].natIp);

// Export the instance's external IP.
export const instanceMainnetExternalIp = instanceSmartProfileMainnet.networkInterfaces.apply(nis => nis[0].accessConfigs?.[0].natIp);

// Create a Public Role in Hasura and give it select permissions to all tables in the schema.
async function applyPublicRole(hasuraUrl: any, adminSecret: string, schemaName: string) {
  const headers = {
    "Content-Type": "application/json",
    "x-hasura-admin-secret": adminSecret,
  };

  const axiosInstance = axios.create({
    baseURL: hasuraUrl,
    headers: headers,
  });

  // Get all tables in the schema
  let tablesResult;
  try {
    const tablesResponse = await axiosInstance.post("/v1/query", {
      type: "run_sql",
      args: {
        sql: `SELECT table_name FROM information_schema.tables WHERE table_schema='${schemaName}';`,
      },
    });
    tablesResult = tablesResponse.data;
  } catch (error) {
    console.error("Error fetching tables:", error);
    return;
  }

  const tables = tablesResult.result.slice(1).map((row: any[]) => row[0]);

  // Apply select permissions to all tables in the schema for the public role
  for (const table of tables) {
    try {
      await axiosInstance.post("/v1/metadata", {
        type: "pg_create_select_permission",
        args: {
          source: "default",
          role: "public",
          table: {
            schema: schemaName,
            name: table,
          },
          permission: {
            columns: "*",
            filter: {},
            allow_aggregations: true,
          },
        },
      });
    } catch (error) {
      const typedError = error as any;
      if (!typedError.response.data.error.includes("select permission already defined")) {
        console.error(`Error applying select permissions for table "${table}":`, typedError);
      }
    }
  }
}

// Apply public role when both hasura services are ready
pulumi.all([hasuraDevnetServiceUrl, hasuraSmartProfileDevnetServiceUrl, hasuraMainnetServiceUrl, hasuraSmartProfileMainnetServiceUrl, hasuraAdminSecret]).apply(async ([hasuraDevnetUrl, smartProfileDevnetUrl, hasuraMainnetUrl, smartProfileMainnetUrl, adminSecret]) => {
  await applyPublicRole(hasuraDevnetUrl, adminSecret, "public");
  await applyPublicRole(hasuraMainnetUrl, adminSecret, "public");
  await applyPublicRole(smartProfileDevnetUrl, adminSecret, "public");
  await applyPublicRole(smartProfileMainnetUrl, adminSecret, "public");
});