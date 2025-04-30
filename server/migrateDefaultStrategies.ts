import { db } from './db';
import { defaultStrategies } from '@shared/schema';
import { sql } from 'drizzle-orm';

async function migrateDefaultStrategiesTable() {
  console.log("[express] Starting default_strategies table creation");
  
  try {
    // Check if default_strategies table exists
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'default_strategies'
      );
    `);
    
    const exists = tableExists.rows[0].exists;
    
    if (exists) {
      console.log("[express] default_strategies table already exists");
      return;
    }
    
    // Create the default_strategies table
    await db.execute(sql`
      CREATE TABLE "default_strategies" (
        "id" SERIAL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "strategy_type" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "parameters" JSONB NOT NULL,
        "parameter_descriptions" JSONB NOT NULL,
        "risk_level" TEXT DEFAULT 'moderate',
        "recommended_assets" JSONB,
        "is_active" BOOLEAN DEFAULT true,
        "display_order" INTEGER DEFAULT 0,
        "created_at" TIMESTAMP DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      );
    `);
    
    console.log("[express] default_strategies table created successfully");
    return true;
  } catch (error) {
    console.error("[express] Error creating default_strategies table:", error);
    return false;
  }
}

async function populateDefaultStrategies() {
  const { storage } = await import("./storage");
  
  try {
    // Import and run the populate script
    const populateModule = await import("./populateDefaultStrategies");
    
    // Check if we have existing strategies first
    const existingStrategies = await storage.getAllDefaultStrategies();
    
    if (existingStrategies.length === 0) {
      console.log("[express] No default strategies found, populating database with templates");
      await populateModule.populateDefaultStrategies();
    } else {
      console.log(`[express] Found ${existingStrategies.length} existing default strategies, skipping population`);
    }
    
    return true;
  } catch (error) {
    console.error("[express] Error populating default strategies:", error);
    return false;
  }
}

export async function runDefaultStrategiesMigration() {
  // First ensure the table exists
  const tableCreated = await migrateDefaultStrategiesTable();
  
  // If table was successfully created or already exists, populate it with default strategies
  if (tableCreated !== false) {
    await populateDefaultStrategies();
  }
}

// Only run if this file is executed directly
import { fileURLToPath } from 'url';
import path from 'path';

// ES Modules equivalent of __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if this file is being run directly
if (process.argv[1] === __filename) {
  runDefaultStrategiesMigration()
    .then(() => {
      console.log("Default strategies migration completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Error during default strategies migration:", error);
      process.exit(1);
    });
}