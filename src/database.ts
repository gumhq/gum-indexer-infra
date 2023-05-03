import { Sequelize } from "sequelize";
import * as pg from "pg";

const host = process.env.POSTGRES_HOST;
const port = Number(process.env.PGPORT) || 5432;
const database = new Sequelize({
  host: host,
  dialect: "postgres",
  port: port,
  logging: false,
  dialectModule: pg,
  username: process.env.POSTGRES_USER,
  database: process.env.POSTGRES_DB_NAME || "gum",
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  hooks: {
    beforeConnect: async (config: any) => {
      let password = process.env.POSTGRES_PASSWORD;
      config.password = password;
    },
  },
});

export default database;