import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

// Password hashing function
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

// Password verification function
async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Set up PostgreSQL session store
const PgSession = connectPgSimple(session);
const sessionStore = new PgSession({
  pool,
  createTableIfMissing: true
});

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "crypto-bot-platform-secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax"
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport to use local strategy
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        // Check if it's an email or username login
        const isEmail = username.includes('@');
        let user;
        
        if (isEmail) {
          user = await storage.getUserByEmail(username);
        } else {
          user = await storage.getUserByUsername(username);
        }

        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false, { message: "Invalid username or password" });
        }
        
        // Update last login time
        await storage.updateUser(user.id, { lastLogin: new Date() });
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // API routes for authentication
  
  // Register new user
  app.post("/api/register", async (req, res, next) => {
    try {
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Check if email already exists
      if (req.body.email) {
        const existingEmail = await storage.getUserByEmail(req.body.email);
        if (existingEmail) {
          return res.status(400).json({ error: "Email already exists" });
        }
      }

      // Create user with hashed password
      const user = await storage.createUser({
        ...req.body,
        password: await hashPassword(req.body.password),
        lastLogin: new Date(),
        updatedAt: new Date()
      });

      // Set up demo environment for new users
      try {
        // Import the initial data loader to create a demo exchange for the new user
        const { createDemoExchangeIfNeeded } = await import("./initialDataLoader");
        
        // Create a demo exchange for this new user
        await createDemoExchangeIfNeeded(user.id);
      } catch (demoError) {
        console.error("Error setting up demo environment for new user:", demoError);
        // Continue anyway - this shouldn't prevent registration
      }

      // Log in the user
      req.login(user, (err) => {
        if (err) return next(err);
        // Return user without password
        const { password, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Error during registration" });
    }
  });

  // Login
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      
      req.login(user, (err) => {
        if (err) return next(err);
        // Return user without password
        const { password, ...userWithoutPassword } = user;
        return res.status(200).json(userWithoutPassword);
      });
    })(req, res, next);
  });

  // Logout
  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.status(200).json({ message: "Logged out successfully" });
    });
  });

  // Get current user
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    // Return user without password
    const { password, ...userWithoutPassword } = req.user as SelectUser;
    res.status(200).json(userWithoutPassword);
  });

  // Update user profile
  app.put("/api/user", async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const userId = (req.user as SelectUser).id;
      const updates = { ...req.body, updatedAt: new Date() };
      
      // If changing password, hash it
      if (updates.password) {
        updates.password = await hashPassword(updates.password);
      }
      
      const user = await storage.updateUser(userId, updates);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      res.status(200).json(userWithoutPassword);
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Error updating user" });
    }
  });
  
  // Delete user account
  app.delete("/api/user", async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const userId = (req.user as SelectUser).id;
      
      // Import here to avoid circular dependencies
      const { deleteUserAccount } = await import("./deleteUserAccount");
      
      // Delete the user account and all associated data
      await deleteUserAccount(userId);
      
      // Log the user out
      req.logout((err) => {
        if (err) return next(err);
        res.status(200).json({ message: "Account deleted successfully" });
      });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Error deleting user account" });
    }
  });

  // Middleware to check if user is authenticated
  app.use("/api/protected/*", (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Authentication required" });
    }
    next();
  });
}

// Helper to hash a password
export const hashUserPassword = hashPassword;

// Middleware to check if user is authenticated
export function isAuthenticated(req: Express.Request, res: Express.Response, next: Express.NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Authentication required" });
}