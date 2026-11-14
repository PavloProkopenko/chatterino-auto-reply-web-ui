/** What the data layer needs from "the file" and from "somewhere to keep backups". Browsers and tests plug in here. */

export interface FileRead {
  text: string;
  /** Last modified time in ms since the epoch (File.lastModified). */
  modified: number;
  size: number;
}

export type WriteFailure = 'busy' | 'permission' | 'other';

/** A write that did not happen. `busy` is worth a few retries (another program has the file), the rest are not. */
export class FileWriteError extends Error {
  reason: WriteFailure;
  constructor(reason: WriteFailure, message: string) {
    super(message);
    this.name = 'FileWriteError';
    this.reason = reason;
  }
}

export interface FileAccess {
  /** The file's text, or null when it does not exist. */
  read(): Promise<FileRead | null>;
  /** Cheap check without reading the content; null when the file does not exist. */
  stat(): Promise<{ modified: number; size: number } | null>;
  /** Replace the content (creating the file if needed). Throws FileWriteError. */
  write(text: string): Promise<void>;
}

export interface BackupInfo {
  id: string;
  /** When the backup was taken, ms since the epoch. */
  at: number;
  size: number;
}

export interface BackupEntry extends BackupInfo {
  text: string;
}

export interface BackupStore {
  add(text: string, at: number): Promise<string>;
  /** Newest first. */
  list(): Promise<BackupInfo[]>;
  get(id: string): Promise<string | null>;
  /** Keep only the newest `keep` backups. */
  prune(keep: number): Promise<void>;
}

/** A folder as the plugin installer sees it. Paths are relative with "/" separators; writes create parent folders. */
export interface PluginDir {
  /** Entries of a folder, or null when the folder does not exist ("" is the root). */
  list(path: string): Promise<{ name: string; kind: 'file' | 'directory' }[] | null>;
  /** A file's text, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}
