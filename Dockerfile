# Use the official Redis Alpine image as the base image for Redis stage
FROM redis:latest AS redis

# Use the official Node.js image as the base image for server stage
FROM node:18

# Create the app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY src/ ./src/

# Expose the server port (8080)
EXPOSE 8080
EXPOSE 8081
EXPOSE 6379

# Install supervisord
RUN apt-get update && apt-get install -y supervisor

# Copy the supervisord configuration file
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy the Redis server binary and configuration file from Redis stage
COPY --from=redis /usr/local/bin/redis-server /usr/local/bin/
COPY redis.conf /etc/redis/redis.conf

# Start the server and Redis using supervisord
CMD ["/usr/bin/supervisord"]
