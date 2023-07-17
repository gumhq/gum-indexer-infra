# Gum Indexer Infrastructure

## Prerequisites

- Docker
- Docker Compose (optional, if you want to use the provided `docker-compose.yml` file)
- Pulumi CLI

## Getting Started

1. Clone the repository:

```
git clone https://github.com/gumhq/gum-indexer-infra.git
cd gum-indexer-infra
```

2. Build the Docker image:

```
docker build -t gum-indexer-infra .
```

3. Set up the environment variables required to run the Docker container:

- `CLUSTER`: The Solana cluster to use, e.g., "mainnet-beta".
- `POSTGRES_HOST`: The PostgreSQL host.
- `POSTGRES_USER`: The PostgreSQL user.
- `POSTGRES_PASSWORD`: The PostgreSQL password.
- `POSTGRES_DB_NAME`: The PostgreSQL database name.

You can either export these variables in your shell or create a `.env` file in the project root directory with the following format:

```
CLUSTER=mainnet-beta
POSTGRES_HOST=your-postgres-host
POSTGRES_USER=your-postgres-user
POSTGRES_PASSWORD=your-postgres-password
POSTGRES_DB_NAME=your-postgres-db-name
```

4. Run the Docker container:

```
docker run -d --name app -p 8080:8080 --restart always --env-file .env gum-indexer-infra
```

If you don't want to use the `.env` file, you can pass the environment variables directly:

```
docker run -d --name app -p 8080:8080 --restart always -e CLUSTER=mainnet-beta -e POSTGRES_HOST=your-postgres-host -e POSTGRES_USER=your-postgres-user -e POSTGRES_PASSWORD=your-postgres-password -e POSTGRES_DB_NAME=your-postgres-db-name gum-indexer-infra
```

5. Check the logs:

```
docker logs -f app
```

The server is now running and listening for incoming requests on port 8080. You can send a POST request to the server's root endpoint (`http://localhost:8080/`) with a JSON payload, and it will be enqueued in Redis and processed by the worker processes.

## Optional: Using Docker Compose

If you prefer to use Docker Compose to manage your containers, you can use the provided `docker-compose.yml` file. Update the environment variables in the `.env` file, and then run:

```
docker-compose up -d
```

This will start the containers defined in the `docker-compose.yml` file, including the application and PostgreSQL containers.

## Deploy Infrastructure to GCP with Pulumi

Follow the README in the `iac` directory to deploy the infrastructure to GCP.

## Acknowledgements

This project incorporates code from the Helium Program Library, specifically from the following modules:

- [defineIdlModels.ts](https://github.com/helium/helium-program-library/blob/master/packages/account-postgres-sink-service/src/utils/defineIdlModels.ts): This module was used as a basis for our `createSchema.ts` file. The original authors are [@bryzettler](https://github.com/bryzettler) and [@ChewingGlass](https://github.com/ChewingGlass).

- [upsertProgramAccounts.ts](https://github.com/helium/helium-program-library/blob/master/packages/account-postgres-sink-service/src/utils/upsertProgramAccounts.ts): This module was used as a basis for our `seed.ts` file. The original authors are [@bryzettler](https://github.com/bryzettler) and [@ChewingGlass](https://github.com/ChewingGlass).

The above mentioned parts of our project use code from the Helium Program Library under the terms of its [Apache License 2.0](https://github.com/helium/helium-program-library/blob/master/LICENSE).
