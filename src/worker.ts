import Redis from "ioredis";
import { Program,  AnchorProvider, Wallet, BorshCoder } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import database from "./database";
import { fetchJsonData } from "./seed";

const REDIS_HOST = "0.0.0.0";
const REDIS_PORT = 6379;
const STREAM_NAME = "gum_events";
const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

const redis = new Redis(REDIS_PORT, REDIS_HOST);
const rpcUrl = process.env.CLUSTER === "mainnet-beta" ? MAINNET_RPC_URL : DEVNET_RPC_URL;

async function main() {
  let last_id = "$";

  let sequelize = database;
  const keypair = Keypair.generate();
  const wallet  = new Wallet(keypair);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {});
  const anchorProgram = await Program.at(new PublicKey("CDDMdCAWB5AXgvEy7XJRggAu37QPG1b9aJXndZoPUkkm"), provider)
  const coder = new BorshCoder(anchorProgram.idl);

  while (true) {
    // Read new entries from the Redis Stream
    const stream_data = await redis.xread("BLOCK", 0, "STREAMS", STREAM_NAME, last_id);

    if (stream_data) {
      for (const stream of stream_data) {
        const messages = stream[1];
        for (const message of messages) {
          const message_id = message[0];
          const message_data = JSON.parse(message[1][1]);

          console.log("message data:", message_data);
          // Loop over all instructions
          for (const instruction of message_data[0].instructions) {
            const decodedData = coder.instruction.decode(
              instruction.data,
              'base58',
            ) as any;

            if (!decodedData) {
              continue;
            }

            const accountMetas = instruction.accounts.map((account: any) => {
              return {
                pubkey: new PublicKey(account)
              };
            });
            const decodedAccountData = coder.instruction.format(decodedData, accountMetas) as any;
            if (!decodedAccountData) {
              continue;
            }
            console.log("decoded data:", decodedData);
            console.log("decoded account data:", decodedAccountData);
            const query = await createQuery(decodedData, decodedAccountData);
            console.log(query);
            
            if (query) {
              await sequelize.query(query); // Execute the query
            } else {
              console.log("No query to execute");
            }
          }
        // Acknowledge the message in the Redis Stream
        await redis.xack(STREAM_NAME, "my_group", message_id);
        last_id = message_id;
        }
      }
    }
  }
}

async function createQuery(decodedData: any, decodedAccountData: any) {
  const date = new Date();
  const isoTimestamp = date.toISOString();

  if (decodedData.name === "createUser") {
    const userAddress = decodedAccountData.accounts.find((account: any) => account.name === "User").pubkey.toBase58();
    const authorityAddress = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const randomHash = decodedData.data.randomHash;
    
    const query = `INSERT INTO public.user (address, authority, random_hash, refreshed_at, created_at) VALUES ('${userAddress}', '${authorityAddress}', '{${randomHash.join(",")}}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "updateUser") {
    const userAddress = decodedAccountData.accounts.find((account: any) => account.name === "User").pubkey.toBase58();
    const authorityAddress = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const randomHash = decodedData.data.randomHash;

    const query = `UPDATE public.user SET authority = '${authorityAddress}', random_hash = '{${randomHash.join(",")}}', refreshed_at = '${isoTimestamp}' WHERE address = '${userAddress}';`;
    return query;
  } else if (decodedData.name === "deleteUser") {
    const userAddress = decodedAccountData.accounts.find((account: any) => account.name === "User").pubkey.toBase58();

    const query = `DELETE FROM public.user WHERE address = '${userAddress}';`;
    return query;
  } else if (decodedData.name === "createPost") {
    const postAddress = decodedAccountData.accounts.find((account: any) => account.name === "Post").pubkey.toBase58();
    const profileAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const randomHash = decodedData.data.randomHash;
    const metadata = await fetchJsonData(metadataUri);
    const metadataJson = JSON.stringify(metadata);

    const query = `INSERT INTO public.post (address, profile, metadata_uri, metadata, random_hash, refreshed_at, created_at) VALUES ('${postAddress}', '${profileAddress}', '${metadataUri}', '${metadataJson}', '{${randomHash.join(",")}}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "updataPost") {
    const postAddress = decodedAccountData.accounts.find((account: any) => account.name === "Post").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const metadata = await fetchJsonData(metadataUri);
    const metadataJson = JSON.stringify(metadata);

    const query = `UPDATE public.post SET metadata_uri = '${metadataUri}', metadata = '${metadataJson}' WHERE address = '${postAddress}';`;
    return query;
  } else if (decodedData.name === "deletePost") {
    const postAddress = decodedAccountData.accounts.find((account: any) => account.name === "Post").pubkey.toBase58();

    const query = `DELETE FROM public.post WHERE address = '${postAddress}';`;
    return query;
  } else if (decodedData.name === "createComment") {
    const replyToAddress = decodedAccountData.accounts.find((account: any) => account.name === "Reply To").pubkey.toBase58();
    const postAddress = decodedAccountData.accounts.find((account: any) => account.name === "Post").pubkey.toBase58();

    const query = `UPDATE public.post SET reply_to = '${replyToAddress}' WHERE address = '${postAddress}';`;
    return query;
  } else if (decodedData.name === "createProfile") {
    const profileAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile").pubkey.toBase58();
    const userAddress = decodedAccountData.accounts.find((account: any) => account.name === "User").pubkey.toBase58();
    const namespace = decodedData.data.namespace;
    const namespaceObj = {
      [namespace.toLowerCase()]: {}
    };
    const namespaceJson = JSON.stringify(namespaceObj);

    const query = `INSERT INTO public.profile (address, "user", namespace, refreshed_at, created_at) VALUES ('${profileAddress}', '${userAddress}', '${namespaceJson}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "deleteProfile") {
    const profileAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile").pubkey.toBase58();

    const query = `DELETE FROM public.profile WHERE address = '${profileAddress}';`;
    return query;
  } else if (decodedData.name === "createProfileMetadata") {
    const profileMetadataAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile Metadata").pubkey.toBase58();
    const profileAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const metadata = await fetchJsonData(metadataUri);
    const metadataJson = JSON.stringify(metadata);

    const query = `INSERT INTO public.profile_metadata (address, profile, metadata_uri,metadata, refreshed_at, created_at) VALUES ('${profileMetadataAddress}', '${profileAddress}', '${metadataUri}', '${metadataJson}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "updateProfileMetadata") {
    const profileMetadataAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile Metadata").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const metadata = await fetchJsonData(metadataUri);
    const metadataJson = JSON.stringify(metadata);

    const query = `UPDATE public.profile_metadata SET metadata_uri = '${metadataUri}', metadata = '${metadataJson}' WHERE address = '${profileMetadataAddress}';`;
    return query;
  } else if (decodedData.name === "deleteProfileMetadata") {
    const profileMetadataAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile Metadata").pubkey.toBase58();

    const query = `DELETE FROM public.profile_metadata WHERE address = '${profileMetadataAddress}';`;
    return query;
  } else if (decodedData.name === "createConnection") {
    const connectionAddress = decodedAccountData.accounts.find((account: any) => account.name === "Connection").pubkey.toBase58();
    const fromProfileAddress = decodedAccountData.accounts.find((account: any) => account.name === "From Profile").pubkey.toBase58();
    const toProfileAddress = decodedAccountData.accounts.find((account: any) => account.name === "To Profile").pubkey.toBase58();

    const query = `INSERT INTO public.connection (address, from_profile, to_profile, refreshed_at, created_at) VALUES ('${connectionAddress}', '${fromProfileAddress}', '${toProfileAddress}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "deleteConnection") {
    const connectionAddress = decodedAccountData.accounts.find((account: any) => account.name === "Connection").pubkey.toBase58();

    const query = `DELETE FROM public.connection WHERE address = '${connectionAddress}';`;
    return query;
  } else if (decodedData.name === "createReaction") {
    const reactionAddress = decodedAccountData.accounts.find((account: any) => account.name === "Reaction").pubkey.toBase58();
    const fromProfileAddress = decodedAccountData.accounts.find((account: any) => account.name === "From Profile").pubkey.toBase58();
    const toPostAddress = decodedAccountData.accounts.find((account: any) => account.name === "To Post").pubkey.toBase58();
    const reactionType = decodedData.data.reactionType;
    const reactionTypeObj = {
      [reactionType.toLowerCase()]: {}
    };
    const reactionTypeJson = JSON.stringify(reactionTypeObj);

    const query = `INSERT INTO public.reaction (address, from_profile, to_post, reaction_type, refreshed_at, created_at) VALUES ('${reactionAddress}', '${fromProfileAddress}', '${toPostAddress}', '${reactionTypeJson}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "deleteReaction") {
    const reactionAddress = decodedAccountData.accounts.find((account: any) => account.name === "Reaction").pubkey.toBase58();

    const query = `DELETE FROM public.reaction WHERE address = '${reactionAddress}';`;
    return query;
  }
}

main();
