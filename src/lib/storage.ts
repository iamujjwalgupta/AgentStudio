import path from "path";

/**
 * Where uploaded and generated files live, as a full path. STORAGE_DIR may be
 * relative ("./storage"); it is resolved once, so a saved path does not depend
 * on the folder the server happens to be started from.
 */
export const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR || "storage");

/**
 * A stored file's path, ready to open. Paths saved before they were made
 * absolute are relative to the app folder ("storage/uploads/…"), which is the
 * storage folder's parent, so they are resolved from there.
 */
export function storedPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(path.dirname(STORAGE_ROOT), p);
}
