import express from "express";
import bodyParser from "body-parser";
import Redis from "ioredis";

const REDIS_HOST = "localhost";
const REDIS_PORT = 6379;
const STREAM_NAME = "gum_events";

const redis = new Redis(REDIS_PORT, REDIS_HOST);
const app = express();
app.use(bodyParser.json());

app.post("/", async (req, res) => {
  const jsonData = req.body;

  // Connect to Redis and enqueue the request data
  await redis.xadd(STREAM_NAME, "*", "data", JSON.stringify(jsonData));

  res.status(200).send("OK");
});

app.listen(8080, () => {
  console.log("Server is listening on port 8080");
});
