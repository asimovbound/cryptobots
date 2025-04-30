import { db, pool } from './db';
import { sql } from 'drizzle-orm';

async function migrateDb() {
  try {
    console.log('Starting database migration...');
    
    // Add displayName column to exchanges table if it doesn't exist
    await db.execute(sql`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'exchanges' AND column_name = 'display_name'
        ) THEN 
          ALTER TABLE exchanges ADD COLUMN display_name text;
        END IF;
      END $$;
    `);
    console.log('Added displayName column if it didn\'t exist');
    
    // Add canWithdraw column to exchanges table if it doesn't exist
    await db.execute(sql`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'exchanges' AND column_name = 'can_withdraw'
        ) THEN 
          ALTER TABLE exchanges ADD COLUMN can_withdraw boolean DEFAULT false;
        END IF;
      END $$;
    `);
    console.log('Added canWithdraw column if it didn\'t exist');
    
    // Set default display names for existing exchanges
    await db.execute(sql`
      UPDATE exchanges
      SET display_name = name
      WHERE display_name IS NULL;
    `);
    console.log('Set default display names for existing exchanges');
    
    console.log('Database migration completed successfully');
  } catch (error) {
    console.error('Error during database migration:', error);
  } finally {
    // Close the database connection
    await pool.end();
  }
}

migrateDb();