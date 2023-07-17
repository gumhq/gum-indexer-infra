// This code is part of the Helium Program Library.
// Original author: @@bryzettler @ChewingGlass (GitHub)
// Source: https://github.com/helium/helium-program-library/blob/master/packages/account-postgres-sink-service/src/utils/upsertProgramAccounts.ts

import { AnchorProvider, Program, Wallet } from "@project-serum/anchor";
import { Connection, GetProgramAccountsFilter, Keypair, PublicKey } from "@solana/web3.js";
import { defineIdlModels } from "./createSchema";
import database from "./database";
const axios = require("axios");
import dotenv from "dotenv";
import connectToDatabase from "./database";

dotenv.config();

export type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T;

export const truthy = <T>(value: T): value is Truthy<T> => !!value;

export const fetchJsonData = async (url: string): Promise<any> => {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error fetching JSON data from URL "${url}":`, error);
    return null;
  }
};

const storeDataInDatabase = async (data: { [key: string]: { publicKey: PublicKey; account: any, slot_created_at: number, slot_updated_at: number }[] }, sequelize: any) => {
  for (const [modelName, instances] of Object.entries(data)) {
    const model = sequelize.model(modelName);
    if (!model) {
      console.error(`Model ${modelName} not found in the database.`);
      continue;
    }
    for (const instance of instances) {
      if (instance.account) {
        for (const [key, value] of Object.entries(instance.account)) {
          if (value instanceof PublicKey) {
            instance.account[key] = value.toBase58();
          }
        }
      }

      let metadata: any = null;
      if (instance.account && instance.account.metadataUri) {
        metadata = await fetchJsonData(instance.account.metadataUri);
        if (!metadata) {
          console.error(`Failed to fetch metadata for "${instance.account.metadataUri}".`);
        }
      }

      await model.upsert({
        address: instance.publicKey.toBase58(),
        ...instance.account,
        metadata: metadata ? metadata : null,
        slot_created_at: instance.slot_created_at || 0,
        slot_updated_at: instance.slot_updated_at || 0,
        refreshed_at: new Date(),
      });
    }
  }
};

const createSchemaAndUpsertArchivalData = async (programId: PublicKey, rpcUrl: string) => {
  const keypair = Keypair.generate();
  const wallet = new Wallet(keypair);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {});
  const anchorProgram = await Program.at(programId, provider);
  const idl = anchorProgram.idl;
  const idlAccounts = idl.accounts;
  let accountsByIDLAccountType: { [key: string]: { publicKey: PublicKey; account: any, slot_created_at: number; slot_updated_at: number; }[] } = {};

  if (!idlAccounts) {
    throw new Error("IDL accounts not found");
  }

  const accounts = Object.keys(idlAccounts).map((key: any) => ({
    type: idlAccounts[key].name,
  }));
  
  const databaseName = process.env.DATABASE_NAME || "gum";
  let sequelize = await connectToDatabase(databaseName);

  // Define the models from the idl accounts and store them in the database
  await defineIdlModels({ idl, accounts, sequelize });

  console.log("Getting accounts from the blockchain");
  
  for (const { type } of accounts) {
    const filter = anchorProgram.coder.accounts.memcmp(type, undefined);
    const coderFilters: GetProgramAccountsFilter[] = [];

    if (filter?.offset != undefined && filter?.bytes != undefined) {
      coderFilters.push({ memcmp: { offset: filter.offset, bytes: filter.bytes } });
    }

    if (filter?.dataSize != undefined) {
      coderFilters.push({ dataSize: filter.dataSize });
    }

    const response = await provider.connection.getProgramAccounts(anchorProgram.programId, {
      commitment: provider.connection.commitment,
      filters: [...coderFilters],
    });

    accountsByIDLAccountType[type] = (
      await Promise.all(
        response.map(async ({ pubkey, account }) => {
          try {
            const signatures = await provider.connection.getConfirmedSignaturesForAddress2(pubkey, {
              limit: 1000,
            });
            const firstSignature = signatures?.[0];
            const lastSignature = signatures?.slice(-1)[0];
            const firstTimestamp = firstSignature?.blockTime ? new Date(firstSignature.blockTime * 1000).toISOString() : null
            const lastTimestamp = lastSignature?.blockTime ? new Date(lastSignature.blockTime * 1000).toISOString() : null
            const firstSlot = firstSignature?.slot;
            const lastSlot = lastSignature?.slot;
            return {
              publicKey: pubkey,
              account: anchorProgram.coder.accounts.decode(type, account.data),
              slot_created_at: firstSlot,
              slot_updated_at: lastSlot,
            };
          } catch (_e) {
            console.error(`Decode error ${pubkey.toBase58()}`, _e);
            return null;
          }
        })
      )
    ).filter(truthy);
  }

  await storeDataInDatabase(accountsByIDLAccountType, sequelize);
};

const GUM_PROGRAM_ID = new PublicKey("CDDMdCAWB5AXgvEy7XJRggAu37QPG1b9aJXndZoPUkkm");
const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
const rpcUrl = process.env.CLUSTER === "mainnet-beta" ? MAINNET_RPC_URL : DEVNET_RPC_URL;

if (!rpcUrl) {
  throw new Error("RPC URL not found");
}
createSchemaAndUpsertArchivalData(GUM_PROGRAM_ID, rpcUrl);