import * as vscode from "vscode";
import { defaultDocument, normalizeDocument } from "./model.js";
import type { LearningDocument } from "./types.js";

export class LearningStore {
  readonly #storageDirectory: vscode.Uri;
  readonly #documentUri: vscode.Uri;
  readonly #workspaceUri: string;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(context: vscode.ExtensionContext, workspaceUri: string) {
    this.#storageDirectory = context.storageUri ?? context.globalStorageUri;
    this.#documentUri = vscode.Uri.joinPath(this.#storageDirectory, "learning-tree.v1.json");
    this.#workspaceUri = workspaceUri;
  }

  async read(): Promise<LearningDocument> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.#documentUri);
      return normalizeDocument(JSON.parse(new TextDecoder().decode(bytes)), this.#workspaceUri);
    } catch (error) {
      if (isFileNotFound(error)) return defaultDocument(this.#workspaceUri);
      throw error;
    }
  }

  write(document: LearningDocument): Promise<void> {
    const write = this.#writeTail.then(() => this.#writeDocument(document));
    this.#writeTail = write.catch(() => undefined);
    return write;
  }

  async #writeDocument(document: LearningDocument): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.#storageDirectory);
    const temporary = vscode.Uri.joinPath(
      this.#storageDirectory,
      `learning-tree.${process.pid}.${Date.now()}.tmp`,
    );
    const bytes = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
    await vscode.workspace.fs.writeFile(temporary, bytes);
    try {
      await vscode.workspace.fs.rename(temporary, this.#documentUri, { overwrite: true });
    } catch (error) {
      try {
        await vscode.workspace.fs.delete(temporary);
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError &&
    (error.code === "FileNotFound" || error.name.toLowerCase().includes("filenotfound"))
  );
}
