# Use the official Hasura image as the base image
FROM hasura/graphql-engine

# Install wget if needed (uncomment the next two lines if wget is required in your use case)
# USER root
# RUN apk add --no-cache wget

# Download and install Cloud SQL Proxy using curl
USER root
RUN curl -o /usr/local/bin/cloud_sql_proxy https://dl.google.com/cloudsql/cloud_sql_proxy.linux.amd64 \
  && chmod +x /usr/local/bin/cloud_sql_proxy

# Switch back to the hasura user
USER hasura
