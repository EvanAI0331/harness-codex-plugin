import fs from "node:fs";
import path from "node:path";

const REQUIRED_FILES = [
  "README.md",
  "ARCHITECTURE.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "RELEASE_CHECKLIST.md",
  ".env.example",
];

const FORBIDDEN_STRINGS = [
  "Harness Studio MVP",
  "internal prototype",
  "private: true",
];

main();

function main(): void {
  const root = process.cwd();
  const problems: string[] = [];

  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, file))) {
      problems.push(`Missing required file: ${file}`);
    }
  }

  const packageJson = readJson(path.join(root, "package.json"));
  if (packageJson.private !== false) {
    problems.push("package.json.private must be false.");
  }
  if (packageJson.name !== "harness-codex-plugin") {
    problems.push("package.json.name must be harness-codex-plugin.");
  }

  scanTextFiles(root, problems);
  checkEnvExample(root, problems);

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`[lint] ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[lint] OK (${REQUIRED_FILES.length} required files checked)`);
}

function checkEnvExample(root: string, problems: string[]): void {
  const content = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  if (!/^DEMO_MODE=false$/m.test(content)) {
    problems.push(".env.example must keep DEMO_MODE=false by default.");
  }
  if (!/^SPECX_MODE=local$/m.test(content)) {
    problems.push(".env.example must keep SPECX_MODE=local by default.");
  }
}

function scanTextFiles(root: string, problems: string[]): void {
  const candidates = [
    "README.md",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "THIRD_PARTY_NOTICES.md",
    "RELEASE_CHECKLIST.md",
    ".env.example",
    "src/components/RequirementForm.tsx",
  ];

  for (const relativePath of candidates) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    for (const forbidden of FORBIDDEN_STRINGS) {
      if (content.includes(forbidden)) {
        problems.push(`Forbidden string "${forbidden}" found in ${relativePath}.`);
      }
    }
  }
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}
