import { db } from "./db";
import { sql } from "drizzle-orm";

async function migrateSpeculationTradesTable() {
  try {
    console.log("Checking if speculation_trades.status column exists...");
    
    // First, check if the column already exists to avoid errors
    const checkResult = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'speculation_trades' 
      AND column_name = 'status'
    `);
    
    if (checkResult.rows.length === 0) {
      console.log("Column 'status' does not exist in 'speculation_trades', adding it now...");
      
      // Add the status column with a default value of 'executed'
      await db.execute(sql`
        ALTER TABLE speculation_trades 
        ADD COLUMN status TEXT NOT NULL DEFAULT 'executed'
      `);
      
      console.log("Column 'status' added successfully.");
    } else {
      console.log("Column 'status' already exists in 'speculation_trades' table.");
    }
    
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Error in migration:", error);
  }
}

// Run the migration
migrateSpeculationTradesTable();