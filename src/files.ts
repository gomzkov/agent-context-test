import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ReadResult {
  kind: "ok" | "missing" | "unreadable";
  content?: string;
  error?: string;
}

export function readText(filePath: string): ReadResult {
  try {
    return { kind: "ok", content: fs.readFileSync(filePath, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing" };
    return {
      kind: "unreadable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

export function findGitRoot(startPath: string): string | undefined {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function pathChain(rootPath: string, destinationPath: string): string[] {
  const root = path.resolve(rootPath);
  const destination = path.resolve(destinationPath);
  const relative = path.relative(root, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [destination];
  const parts = relative ? relative.split(path.sep) : [];
  const chain = [root];
  for (let index = 1; index <= parts.length; index++) {
    chain.push(path.join(root, ...parts.slice(0, index)));
  }
  return chain;
}

export function ancestorChain(destinationPath: string): string[] {
  const chain: string[] = [];
  let current = path.resolve(destinationPath);
  while (true) {
    chain.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain.reverse();
}

export function displayPath(
  absolutePath: string,
  projectRoot: string,
  homeDirectory: string,
): string {
  const absolute = path.resolve(absolutePath);
  const project = path.resolve(projectRoot);
  const home = path.resolve(homeDirectory);
  const projectRelative = path.relative(project, absolute);
  if (
    projectRelative === "" ||
    (!projectRelative.startsWith("..") && !path.isAbsolute(projectRelative))
  ) {
    return projectRelative === "" ? "." : projectRelative.split(path.sep).join("/");
  }
  const homeRelative = path.relative(home, absolute);
  if (!homeRelative.startsWith("..") && !path.isAbsolute(homeRelative)) {
    return homeRelative === "" ? "~" : `~/${homeRelative.split(path.sep).join("/")}`;
  }
  return absolute.split(path.sep).join("/");
}

export function fingerprint(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function normalizeText(content: string): string {
  return content
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function findNormalizedLine(content: string, needle: string): number | undefined {
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return undefined;
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (normalizeText(lines[index] ?? "").includes(normalizedNeedle)) return index + 1;
  }
  return normalizeText(content).includes(normalizedNeedle) ? 1 : undefined;
}

export function listMarkdownFiles(directoryPath: string): string[] {
  if (!isDirectory(directoryPath)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
    }
  };
  visit(directoryPath);
  return files;
}

export function listSkillFiles(directoryPath: string): string[] {
  if (!isDirectory(directoryPath)) return [];
  try {
    return fs
      .readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => path.join(directoryPath, entry.name, "SKILL.md"))
      .filter((skillPath) => fs.existsSync(skillPath));
  } catch {
    return [];
  }
}

export function globMatches(pattern: string, candidate: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  let expression = "^";
  for (let index = 0; index < normalizedPattern.length; index++) {
    const character = normalizedPattern[index]!;
    const next = normalizedPattern[index + 1];
    if (character === "*" && next === "*") {
      expression += ".*";
      index++;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  expression += "$";
  return new RegExp(expression).test(normalizedCandidate);
}

