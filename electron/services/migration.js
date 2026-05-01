/**
 * Migration System untuk Barangmudo POS
 * 
 * Menangani perubahan struktur data antar versi.
 * Setiap migrasi harus idempotent (aman jika dijalankan > 1 kali).
 * 
 * Alur:
 * 1. Baca dataVersion dari config file atau default ke "1.0.0"
 * 2. Jalankan migrasi berurutan hingga versi terbaru
 * 3. Simpan dataVersion baru ke config
 */

const fs = require("fs");
const path = require("path");

function compareSemver(a, b) {
  const pa = String(a || "0.0.0").split(".").map((n) => Number(n) || 0);
  const pb = String(b || "0.0.0").split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i += 1) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }

  return 0;
}

const MIGRATIONS = {
  "1.0.0": {
    description: "Initial schema (no migration needed)",
    migrate: () => {
      // v1.0.0 adalah versi baseline
      return { success: true };
    }
  },
  "1.1.0": {
    description: "Add account system with AES encryption",
    migrate: (app) => {
      try {
        const accountAuth = require("./accountAuth");

        // Ensure accounts storage can be loaded without forcing a default credential.
        accountAuth.listAccounts(app);
        console.log("[Migration 1.1.0] Account system initialized.");
        return { success: true };
      } catch (err) {
        console.warn("[Migration 1.1.0] Warning:", err.message);
        // Non-blocking: jika fail, user setup manual saja saat startup
        return { success: true, warnings: [err.message] };
      }
    }
  },
  "1.2.0": {
    description: "Add data backup tracking",
    migrate: (app) => {
      try {
        // Ensure backup folder exists
        const userData = app.getPath("userData");
        const backupDir = path.join(userData, "backups");
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
          console.log("[Migration 1.2.0] Backup directory created.");
        }
        
        // Create initial backup marker file
        const markerPath = path.join(backupDir, ".backup-marker");
        if (!fs.existsSync(markerPath)) {
          fs.writeFileSync(markerPath, JSON.stringify({
            lastBackup: new Date().toISOString(),
            dataVersion: "1.2.0"
          }));
        }
        
        console.log("[Migration 1.2.0] Backup system initialized.");
        return { success: true };
      } catch (err) {
        console.warn("[Migration 1.2.0] Warning:", err.message);
        return { success: true, warnings: [err.message] };
      }
    }
  }
};

/**
 * Read current data version from config file
 * @param {Electron.App} app 
 * @returns {string} version like "1.0.0"
 */
function getDataVersion(app) {
  const userData = app.getPath("userData");
  const configPath = path.join(userData, ".data-version");
  
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8").trim();
      return content || "1.0.0";
    } catch (err) {
      console.warn("[Migration] Failed to read version file:", err.message);
      return "1.0.0";
    }
  }
  
  return "1.0.0";
}

/**
 * Save current data version to config file
 * @param {Electron.App} app 
 * @param {string} version 
 */
function saveDataVersion(app, version) {
  const userData = app.getPath("userData");
  const configPath = path.join(userData, ".data-version");
  
  try {
    fs.writeFileSync(configPath, version, "utf-8");
  } catch (err) {
    console.warn("[Migration] Failed to write version file:", err.message);
  }
}

/**
 * Get latest available version
 * @returns {string}
 */
function getLatestVersion() {
  return Object.keys(MIGRATIONS).sort(compareSemver).pop() || "1.0.0";
}

/**
 * Run all pending migrations from current -> latest
 * @param {Electron.App} app 
 * @returns {{ success: boolean, currentVersion: string, migrated: string[], warnings: string[] }}
 */
function runMigrations(app) {
  const currentVersion = getDataVersion(app);
  const latestVersion = getLatestVersion();
  const migrated = [];
  const warnings = [];

  console.log(`[Migration] Current data version: ${currentVersion}`);
  console.log(`[Migration] Latest available: ${latestVersion}`);

  if (currentVersion === latestVersion) {
    console.log("[Migration] Data already up-to-date.");
    return {
      success: true,
      currentVersion,
      migrated: [],
      warnings: []
    };
  }

  // Get sorted list of versions to migrate through
  const versions = Object.keys(MIGRATIONS).sort(compareSemver);
  const startIdx = versions.indexOf(currentVersion);
  const targetVersions = startIdx >= 0
    ? versions.slice(startIdx + 1)
    : versions.filter((version) => compareSemver(version, currentVersion) > 0);

  console.log(`[Migration] Will migrate through: ${targetVersions.join(" -> ")}`);

  // Run migrations sequentially
  for (const version of targetVersions) {
    try {
      const migration = MIGRATIONS[version];
      if (!migration) {
        console.warn(`[Migration] Skipping unknown version ${version}`);
        continue;
      }

      console.log(`[Migration] Running ${version}: ${migration.description}...`);
      const result = migration.migrate(app);

      if (result.success) {
        migrated.push(version);
        console.log(`[Migration] ✓ ${version} completed`);
        
        if (result.warnings && Array.isArray(result.warnings)) {
          warnings.push(...result.warnings);
        }
      } else {
        console.warn(`[Migration] ✗ ${version} failed:`, result.error || "Unknown error");
        throw new Error(result.error || `Migration ${version} failed`);
      }
    } catch (err) {
      console.error(`[Migration] Error during ${version}:`, err.message);
      return {
        success: false,
        currentVersion,
        migrated,
        error: err.message,
        failedVersion: version,
        warnings
      };
    }
  }

  // Save new version
  if (migrated.length > 0) {
    saveDataVersion(app, latestVersion);
    console.log(`[Migration] Data version updated to ${latestVersion}`);
  }

  return {
    success: true,
    currentVersion,
    newVersion: latestVersion,
    migrated,
    warnings
  };
}

/**
 * Create JSON backup of pos-data folder
 * @param {Electron.App} app 
 * @param {string} reason - "pre-update", "startup", "manual", dll
 * @returns {{ success: boolean, backupPath: string, timestamp: string }}
 */
function createBackup(app, reason = "manual") {
  const userData = app.getPath("userData");
  const backupDir = path.join(userData, "backups");
  const posDataDir = path.join(userData, "pos-data");

  try {
    // Ensure backup dir exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Timestamp untuk filename
    const now = new Date();
    const iso = now.toISOString().replace(/[:.]/g, "-").slice(0, -5); // 2026-05-01T09-30-45
    const filename = `backup-${reason}-${iso}.json`;
    const backupPath = path.join(backupDir, filename);

    // Backup structure: metadata + all JSON files di pos-data
    const backup = {
      timestamp: now.toISOString(),
      reason,
      dataVersion: getDataVersion(app),
      files: {}
    };

    // Copy all JSON files dari pos-data ke backup
    if (fs.existsSync(posDataDir)) {
      const files = fs.readdirSync(posDataDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(posDataDir, file);
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            backup.files[file] = JSON.parse(content);
          } catch (err) {
            console.warn(`[Backup] Failed to read ${file}:`, err.message);
          }
        }
      }
    }

    // Write backup file
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`[Backup] Created: ${backupPath}`);

    // Update backup marker
    const markerPath = path.join(backupDir, ".backup-marker");
    fs.writeFileSync(markerPath, JSON.stringify({
      lastBackup: now.toISOString(),
      reason,
      backupFile: filename,
      dataVersion: getDataVersion(app)
    }));

    // Cleanup old backups (keep last 10)
    const allBackups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("backup-"))
      .sort()
      .reverse();
    
    for (const oldBackup of allBackups.slice(10)) {
      try {
        fs.unlinkSync(path.join(backupDir, oldBackup));
        console.log(`[Backup] Cleaned up old backup: ${oldBackup}`);
      } catch (err) {
        console.warn(`[Backup] Failed to remove old backup:`, err.message);
      }
    }

    return {
      success: true,
      backupPath,
      timestamp: now.toISOString()
    };
  } catch (err) {
    console.error(`[Backup] Failed to create backup:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Restore backup file to pos-data
 * @param {Electron.App} app 
 * @param {string} backupPath 
 * @returns {{ success: boolean, restored: number, error?: string }}
 */
function restoreBackup(app, backupPath) {
  const userData = app.getPath("userData");
  const posDataDir = path.join(userData, "pos-data");

  try {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
    if (!backup.files || typeof backup.files !== "object") {
      throw new Error("Invalid backup format");
    }

    // Ensure pos-data dir exists
    if (!fs.existsSync(posDataDir)) {
      fs.mkdirSync(posDataDir, { recursive: true });
    }

    // Restore all files
    let restored = 0;
    for (const [filename, content] of Object.entries(backup.files)) {
      const filePath = path.join(posDataDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
      restored++;
    }

    console.log(`[Restore] Restored ${restored} files from ${path.basename(backupPath)}`);
    return { success: true, restored };
  } catch (err) {
    console.error(`[Restore] Failed to restore backup:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = {
  runMigrations,
  getDataVersion,
  saveDataVersion,
  getLatestVersion,
  createBackup,
  restoreBackup
};
