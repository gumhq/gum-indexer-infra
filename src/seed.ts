import { AnchorProvider, Program, Wallet } from "@project-serum/anchor";
import { Connection, GetProgramAccountsFilter, Keypair, PublicKey } from "@solana/web3.js";
import { defineIdlModels } from "./createSchema";
import database from "./database";

export type Truthy<T> = T extends false | "" | 0 | null | undefined ? never : T;

export const truthy = <T>(value: T): value is Truthy<T> => !!value;

const storeDataInDatabase = async (data: { [key: string]: { publicKey: PublicKey; account: any }[] }, sequelize: any) => {
  for (const [modelName, instances] of Object.entries(data)) {
    // Ensure the correct model name is used
    const model = sequelize.model(modelName);
    if (!model) {
      console.error(`Model ${modelName} not found in the database.`);
      continue;
    }
    for (const instance of instances) {
      // if instance value is PublicKey, convert to base58 string
      if (instance.account) {
        for (const [key, value] of Object.entries(instance.account)) {
          if (value instanceof PublicKey) {
            instance.account[key] = value.toBase58();
          }
        }
      }
      await model.upsert({
        address: instance.publicKey.toBase58(),
        ...instance.account,
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
  let accountsByIDLAccountType: { [key: string]: { publicKey: PublicKey; account: any }[] } = {};

  if (!idlAccounts) {
    throw new Error("IDL accounts not found");
  }

  const accounts = Object.keys(idlAccounts).map((key: any) => ({
    type: idlAccounts[key].name,
  }));

  let sequelize = database;

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
            return {
              publicKey: pubkey,
              account: anchorProgram.coder.accounts.decode(type, account.data),
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
const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";
const rpcUrl = process.env.CLUSTER === "mainnet-beta" ? MAINNET_RPC_URL : DEVNET_RPC_URL;

createSchemaAndUpsertArchivalData(GUM_PROGRAM_ID, rpcUrl);