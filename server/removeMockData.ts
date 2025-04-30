import { db } from "./db";
import { eq, sql } from "drizzle-orm";
import { users } from "@shared/schema";

async function removeMockData(email: string) {
  try {
    // Find the user ID
    const [user] = await db.select().from(users).where(eq(users.email, email));
    
    if (!user) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }
    
    const userId = user.id;
    console.log(`Found user with ID: ${userId}`);

    // Execute direct SQL to update the user's settings in Dashboard.tsx
    await db.execute(sql`
      UPDATE users
      SET 
        risk_profile = 'moderate',
        max_drawdown = 10,
        updated_at = NOW()
      WHERE id = ${userId};
    `);
    
    console.log("User profile reset successfully!");
  } catch (error) {
    console.error("Error resetting user profile:", error);
  } finally {
    process.exit(0);
  }
}

// Run for the specific email provided
removeMockData("asimovbound@gmail.com");