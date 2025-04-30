import { db } from "./db";
import { sql } from "drizzle-orm";

async function createWalletsTable() {
  try {
    // Check if the wallets table already exists
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'wallets'
      );
    `);
    
    if (tableExists.rows[0].exists === true) {
      console.log("Wallets table already exists, checking for required columns...");
      
      // Check if the currency column exists
      const currencyExists = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = 'wallets'
          AND column_name = 'currency'
        );
      `);
      
      if (currencyExists.rows[0].exists === false) {
        console.log("Adding currency column to wallets table");
        await db.execute(sql`
          ALTER TABLE wallets
          ADD COLUMN currency text NOT NULL DEFAULT 'USDT';
        `);
      }
      
      // Check if the updatedAt column exists
      const updatedAtExists = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = 'wallets'
          AND column_name = 'updated_at'
        );
      `);
      
      if (updatedAtExists.rows[0].exists === false) {
        console.log("Adding updated_at column to wallets table");
        await db.execute(sql`
          ALTER TABLE wallets
          ADD COLUMN updated_at timestamp NOT NULL DEFAULT NOW();
        `);
      }
      
      // Make address column nullable if it's not already
      const addressNullable = await db.execute(sql`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'wallets'
        AND column_name = 'address';
      `);
      
      if (addressNullable.rows.length > 0 && addressNullable.rows[0].is_nullable === 'NO') {
        console.log("Making address column nullable");
        await db.execute(sql`
          ALTER TABLE wallets
          ALTER COLUMN address DROP NOT NULL;
        `);
      }
      
      console.log("Wallets table is up to date");
    } else {
      console.log("Creating wallets table");
      await db.execute(sql`
        CREATE TABLE wallets (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          address TEXT,
          balance REAL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USDT',
          last_updated TIMESTAMP DEFAULT NOW(),
          notes TEXT,
          is_tracking BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
      console.log("Wallets table created successfully");
    }
    
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Error migrating wallets table:", error);
  } finally {
    process.exit(0);
  }
}

createWalletsTable();