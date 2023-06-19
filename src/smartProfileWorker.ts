import Redis from "ioredis";
import { Program,  AnchorProvider, Wallet, BorshCoder } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { fetchJsonData } from "./seed";
import connectToDatabase from "./database";

const REDIS_HOST = "0.0.0.0";
const REDIS_PORT = 6379;
const STREAM_NAME = "gum_smart_profile_events";
const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";

const redis = new Redis(REDIS_PORT, REDIS_HOST);
const rpcUrl = process.env.CLUSTER === "mainnet-beta" ? MAINNET_RPC_URL : DEVNET_RPC_URL;

async function main() {
  let last_id = "$";

  if (!rpcUrl) {
    throw new Error("RPC URL not found");
  }
  
  const databaseName = process.env.SMARTPROFILE_DATABASE_NAME || "gumcore";
  let sequelize = await connectToDatabase(databaseName);
  const keypair = Keypair.generate();
  const wallet  = new Wallet(keypair);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {});
  const anchorProgram = await Program.at(new PublicKey("6MhUAJtKdJx3RDCffUsJsQm8xy9YhhywjEmMYrxRc5j6"), provider)
  const coder = new BorshCoder(anchorProgram.idl);
  const nameServiceProgram = await Program.at(new PublicKey("5kWEYrdyryq3jGP5sUcKwTySzxr3dHzWFBVA3vkt6Nj5") , provider);
  const nameServiceCoder = new BorshCoder(nameServiceProgram.idl);

  while (true) {
    try {
    // Read new entries from the Redis Stream
    const stream_data = await redis.xread("BLOCK", 0, "STREAMS", STREAM_NAME, last_id);
    if (stream_data) {
      for (const stream of stream_data) {
        try {
          const messages = stream[1];
          for (const message of messages) {
            try {
              const message_id = message[0];
              const message_data = JSON.parse(message[1][1]);

              console.log("message data:", JSON.stringify(message_data, null, 2));
              // Loop over all instructions
              for (const instruction of message_data[0].instructions) {
                try {
                  let decodedData;
                  let decodedAccountData;
                  if (instruction.programId === "5kWEYrdyryq3jGP5sUcKwTySzxr3dHzWFBVA3vkt6Nj5") {
                    console.log(`Decoding nameservice instruction`);
                    decodedData = nameServiceCoder.instruction.decode(
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
                    decodedAccountData = nameServiceCoder.instruction.format(decodedData, accountMetas) as any;
                    if (!decodedAccountData) {
                      continue;
                    }
                  } else {
                    console.log("Decoding smart profile instruction")
                    decodedData = coder.instruction.decode(
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
                    decodedAccountData = coder.instruction.format(decodedData, accountMetas) as any;
                    if (!decodedAccountData) {
                      continue;
                    }
                  }

                  console.log("decoded data:", JSON.stringify(decodedData, null, 2));
                  console.log("decoded account data:", JSON.stringify(decodedAccountData, null, 2));
                  const query = await createQuery(decodedData, decodedAccountData);
                  console.log(query);
                  
                  if (query) {
                    await sequelize.query(query); // Execute the query
                  } else {
                    console.log("No query to execute");
                  }
                } catch(error:any) {
                  console.error("Error occurred while processing instruction", error.stack);
                }
              }
              // Acknowledge the message in the Redis Stream
              await redis.xack(STREAM_NAME, "my_group", message_id);
              last_id = message_id;
            } catch(error:any) {
              console.error("Error occurred while processing message", error.stack);
            }
          }
        } catch(error:any) {
          console.error("Error occurred while processing stream", error.stack);
        }
      }
    }
  } catch(error:any) {
    console.error("Error occurred while processing stream data", error.stack);
  }
  }
}

async function createQuery(decodedData: any, decodedAccountData: any) {
  const date = new Date();
  const isoTimestamp = date.toISOString();

  if (decodedData.name === "createPost") {
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
    const authorityAddress = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const screenName = decodedAccountData.accounts.find((account: any) => account.name === "Screen Name").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const randomHash = decodedData.data.randomHash;
    const metadata = await fetchJsonData(metadataUri);
    const metadataJson = JSON.stringify(metadata);

    const query = `INSERT INTO public.profile (address, authority, metadata_uri, metadata, screen_name, random_hash, refreshed_at, created_at) VALUES ('${profileAddress}', '${authorityAddress}', '${metadataUri}', '${metadataJson}', '${screenName}', '{${randomHash.join(",")}}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "updateProfile") {
    const profileAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const metadata = await fetchJsonData(metadataUri);
    const metadataJson = JSON.stringify(metadata);

    const query = `UPDATE public.profile SET metadata_uri = '${metadataUri}', metadata = '${metadataJson}' WHERE address = '${profileAddress}';`;
    return query;
  } else if (decodedData.name === "deleteProfile") {
    const profileAddress = decodedAccountData.accounts.find((account: any) => account.name === "Profile").pubkey.toBase58();

    const query = `DELETE FROM public.profile WHERE address = '${profileAddress}';`;
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

    const query = `INSERT INTO public.reaction (address, from_profile, to_post, reaction_type, refreshed_at, created_at) VALUES ('${reactionAddress}', '${fromProfileAddress}', '${toPostAddress}', '${reactionType}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "deleteReaction") {
    const reactionAddress = decodedAccountData.accounts.find((account: any) => account.name === "Reaction").pubkey.toBase58();

    const query = `DELETE FROM public.reaction WHERE address = '${reactionAddress}';`;
    return query;
  } else if (decodedData.name === "createNameRecord") {
    const nameRecordAddress = decodedAccountData.accounts.find((account: any) => account.name === "Name Record").pubkey.toBase58();
    const domainAddress = decodedAccountData.accounts.find((account: any) => account.name === "Domain").pubkey.toBase58();
    const authority = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const name = decodedData.data.name;

    const query = `INSERT INTO public.name_record (address, domain, authority, name, refreshed_at, created_at) VALUES ('${nameRecordAddress}', '${domainAddress}', '${authority}', '${name}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "transferNameRecord") {
    const nameRecordAddress = decodedAccountData.accounts.find((account: any) => account.name === "Name Record").pubkey.toBase58();
    const newAuthority = decodedAccountData.accounts.find((account: any) => account.name === "New Authority").pubkey.toBase58();

    const query = `UPDATE public.name_record SET authority = '${newAuthority}' WHERE address = '${nameRecordAddress}';`;
    return query;
  } else if (decodedData.name === "createTld") {
    const tldAddress = decodedAccountData.accounts.find((account: any) => account.name === "Name Record").pubkey.toBase58();
    const authority = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const domainAddress = decodedAccountData.accounts.find((account: any) => account.name === "Domain").pubkey.toBase58();
    const name = decodedData.data.name;

    const query = `INSERT INTO public.name_record (address, authority, domain, name, refreshed_at, created_at) VALUES ('${tldAddress}', '${authority}', '${domainAddress}', '${name}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "createBadge") {
    const issuerAddress = decodedAccountData.accounts.find((account: any) => account.name === "Issuer").pubkey.toBase58();
    const schemaAddress = decodedAccountData.accounts.find((account: any) => account.name === "Schema").pubkey.toBase58();
    const badgeAddress = decodedAccountData.accounts.find((account: any) => account.name === "Badge").pubkey.toBase58();
    const holderAddress = decodedAccountData.accounts.find((account: any) => account.name === "Holder").pubkey.toBase58();
    const updateAuthorityAddress = decodedAccountData.accounts.find((account: any) => account.name === "Update Authority").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;

    const query = `INSERT INTO public.badge (address, issuer, schema, holder, update_authority, metadata_uri, refreshed_at, created_at) VALUES ('${badgeAddress}', '${issuerAddress}', '${schemaAddress}', '${holderAddress}', '${updateAuthorityAddress}', '${metadataUri}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "updateBadge") {
    const badgeAddress = decodedAccountData.accounts.find((account: any) => account.name === "Badge").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;

    const query = `UPDATE public.badge SET metadata_uri = '${metadataUri}' WHERE address = '${badgeAddress}';`;
    return query;
  } else if (decodedData.name === "deleteBadge") {
    const badgeAddress = decodedAccountData.accounts.find((account: any) => account.name === "Badge").pubkey.toBase58();

    const query = `DELETE FROM public.badge WHERE address = '${badgeAddress}';`;
    return query;
  } else if (decodedData.name === "createSchema") {
    const schemaAddress = decodedAccountData.accounts.find((account: any) => account.name === "Schema").pubkey.toBase58();
    const authority = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;
    const randomHash = decodedData.data.randomHash;

    const query = `INSERT INTO public.schema (address, authority, metadata_uri, random_hash, refreshed_at, created_at) VALUES ('${schemaAddress}', '${authority}', '${metadataUri}', '{${randomHash.join(",")}}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "updateSchema") {
    const schemaAddress = decodedAccountData.accounts.find((account: any) => account.name === "Schema").pubkey.toBase58();
    const metadataUri = decodedData.data.metadataUri;

    const query = `UPDATE public.schema SET metadata_uri = '${metadataUri}' WHERE address = '${schemaAddress}';`;
    return query;
  } else if (decodedData.name === "deleteSchema") {
    const schemaAddress = decodedAccountData.accounts.find((account: any) => account.name === "Schema").pubkey.toBase58();

    const query = `DELETE FROM public.schema WHERE address = '${schemaAddress}';`;
    return query;
  } else if (decodedData.name === "createIssuer") {
    const issuerAddress = decodedAccountData.accounts.find((account: any) => account.name === "Issuer").pubkey.toBase58();
    const authority = decodedAccountData.accounts.find((account: any) => account.name === "Authority").pubkey.toBase58();
    const verified = false;

    const query = `INSERT INTO public.issuer (address, authority, verified, refreshed_at, created_at) VALUES ('${issuerAddress}', '${authority}', '${verified}', '${isoTimestamp}', '${isoTimestamp}');`;
    return query;
  } else if (decodedData.name === "verifyIssuer") {
    const issuerAddress = decodedAccountData.accounts.find((account: any) => account.name === "Issuer").pubkey.toBase58();
    const verified = true;

    const query = `UPDATE public.issuer SET verified = '${verified}' WHERE address = '${issuerAddress}';`;
    return query;
  } else if (decodedData.name === "deleteIssuer") {
    const issuerAddress = decodedAccountData.accounts.find((account: any) => account.name === "Issuer").pubkey.toBase58();

    const query = `DELETE FROM public.issuer WHERE address = '${issuerAddress}';`;
    return query;
  }
}

main().catch((error) => {
  console.error("Uncaught error in main", error.stack);
});
