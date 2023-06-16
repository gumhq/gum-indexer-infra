import { Sequelize } from "sequelize";
import * as pg from "pg";

const connectToDatabase = async (databaseName: string): Promise<Sequelize> => {
  const host = process.env.POSTGRES_HOST;
  const port = Number(process.env.PGPORT) || 5432;
  const username = process.env.POSTGRES_USER || "gumuser";
  const password = process.env.POSTGRES_PASSWORD;

  // Create a temporary connection without specifying the database name
  const tempConnection = new Sequelize({
    host: host,
    dialect: "postgres",
    port: port,
    logging: false,
    dialectModule: pg,
    username: username,
    password: password,
  });

// Try to create the database if it doesn't exist yet
await tempConnection.query(`CREATE DATABASE IF NOT EXISTS "${databaseName}";`).catch(err => {
  console.log(`Database ${databaseName} already exists`);
});

  // Close the temporary connection
  await tempConnection.close();

  // Create a new connection to the desired database
  const database = new Sequelize({
    host: host,
    dialect: "postgres",
    port: port,
    logging: false,
    dialectModule: pg,
    username: username,
    password: password,
    database: databaseName,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    hooks: {
      beforeConnect: async (config: any) => {
        config.password = password;
      },
    },
  });

  return database;
};

export default connectToDatabase;