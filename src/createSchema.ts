import { Sequelize, DataTypes } from "sequelize";
import * as anchor from "@project-serum/anchor";
import { underscore } from "inflection";

const TypeMap = new Map<string, any>([
  ["string", DataTypes.STRING],
  ["publicKey", DataTypes.STRING],
  ["i16", DataTypes.INTEGER],
  ["u8", DataTypes.INTEGER.UNSIGNED],
  ["i16", DataTypes.INTEGER],
  ["u16", DataTypes.INTEGER.UNSIGNED],
  ["i32", DataTypes.INTEGER],
  ["u32", DataTypes.INTEGER.UNSIGNED],
  ["i64", DataTypes.DECIMAL],
  ["u64", DataTypes.DECIMAL.UNSIGNED],
  ["i128", DataTypes.DECIMAL],
  ["u128", DataTypes.DECIMAL.UNSIGNED],
  ["bool", DataTypes.BOOLEAN],
]);

const determineType = (type: string | object): any => {
  if (typeof type === "string" && TypeMap.has(type)) {
    return TypeMap.get(type);
  }

  if (typeof type === "object") {
    const [key, value] = Object.entries(type)[0];

    if (key === "array" && Array.isArray(value)) {
      const [arrayType] = value;
      if (TypeMap.has(arrayType)) {
        return DataTypes.ARRAY(TypeMap.get(arrayType));
      }
    } else if (key === "vec") {
      const vecType = value;
      return DataTypes.ARRAY(determineType(vecType));
    } else {
      return determineType(value);
    }
  }

  return DataTypes.JSONB;
};

const createSchemaIfNecessary = async (
  sequelize: Sequelize,
  accountConfig: { type: string; table?: string; schema?: string }
) => {
  if (accountConfig.schema) {
    await sequelize.createSchema(accountConfig.schema, {});
  }
};

const defineModel = (
  sequelize: Sequelize,
  account: any,
  accountConfig: { type: string; table?: string; schema?: string },
  schema: { [key: string]: any }
) => {
  const modelDefinition = {
    address: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    ...schema[account.name],
    refreshed_at: {
      type: DataTypes.DATE,
    },
    slot_created_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    slot_updated_at: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
  };

  // Add metadata column to post and profile_metadata tables
  if (account.name === 'Post' || account.name === 'ProfileMetadata') {
    modelDefinition['metadata'] = {
      type: DataTypes.JSONB,
    };
  }

  return sequelize.define(
    account.name,
    modelDefinition,
    {
      underscored: true,
      updatedAt: false,
      schema: underscore(accountConfig.schema || "public"),
      tableName: underscore(accountConfig.table || account.name),
    }
  );
};

export const defineIdlModels = async ({
  idl,
  accounts,
  sequelize,
}: {
  idl: anchor.Idl;
  accounts: { type: string; table?: string; schema?: string }[];
  sequelize: Sequelize;
}) => {
  const definedModels = []; // Keep track of defined models

  for (const account of idl.accounts!) {
    const accountConfig = accounts.find(({ type }) => type === account.name);

    if (accountConfig) {
      let schema: { [key: string]: any } = {};
      for (const field of account.type.fields) {
        schema[account.name] = {
          ...schema[account.name],
          [field.name]: determineType(field.type),
        };
      }

      await createSchemaIfNecessary(sequelize, accountConfig);

      const definedModel = defineModel(
        sequelize,
        account,
        accountConfig,
        schema
      );
      definedModels.push(definedModel);
    }
  }

  // Create tables for all defined models or update the existing ones
  for (const model of definedModels) {
    await model.sync({ alter: true });
  }
};
