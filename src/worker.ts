import Redis from "ioredis";
import { Client } from "pg";
import { Program,  AnchorProvider, Wallet, BorshCoder } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// // Get PostgreSQL connection information from environment variables
// const connectionName = process.env.POSTGRES_CONNECTION_NAME;
// const user = process.env.POSTGRES_USER;
// const password = process.env.POSTGRES_PASSWORD;
// const postgresDBName = process.env.POSTGRES_DB_NAME;

// // Build the PostgreSQL connection string using the environment variables
// const connectionString = `postgresql://${user}:${password}@/${postgresDBName}?host=/cloudsql/${connectionName}`;

// // Connect to the PostgreSQL instance
// const client = new Client({ connectionString });

const REDIS_HOST = "0.0.0.0";
const REDIS_PORT = 6379;
const STREAM_NAME = "gum_events";

const redis = new Redis(REDIS_PORT, REDIS_HOST);

async function process_data(data: any) {
  // Add logic to process the data if needed
  return data;
}

async function main() {
  let last_id = "$";

  const keypair = Keypair.generate();
  const wallet  = new Wallet(keypair);
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, wallet, {});
  const anchorProgram = await Program.at(new PublicKey("CDDMdCAWB5AXgvEy7XJRggAu37QPG1b9aJXndZoPUkkm"), provider)
  const coder = new BorshCoder(anchorProgram.idl);

  // // Connect to the PostgreSQL database
  // await client.connect();

  while (true) {
    // Read new entries from the Redis Stream
    const stream_data = await redis.xread("BLOCK", 0, "STREAMS", STREAM_NAME, last_id);

    if (stream_data) {
      for (const stream of stream_data) {
        const messages = stream[1];
        for (const message of messages) {
          const message_id = message[0];
          const message_data = JSON.parse(message[1][1]);

          const processed_data = await process_data(message_data);

          const ix = coder.instruction.decode(
            processed_data[0].instructions[0].data,
            'base58',
          );
          if(!ix) throw new Error("could not parse data");
          const accountMetas = processed_data[0].instructions[0].accounts.map((account: any) => {
            return {
              pubkey: new PublicKey(account)
            };
          });
          const formatted = coder.instruction.format(ix, accountMetas);
          console.log(ix, formatted);

          // TODO: Add logic to insert the data into the PostgreSQL database

          // Acknowledge the message in the Redis Stream
          await redis.xack(STREAM_NAME, "my_group", message_id);
          last_id = message_id;
        }
      }
    }
  }
}

main();
