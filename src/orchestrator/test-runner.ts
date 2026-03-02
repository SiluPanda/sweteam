import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { addMessage } from "../session/manager.js";

export interface TestResult {
  passed: boolean;
  output: string;
  command: string;
}

function detectTestCommand(repoPath: string): string | null {
  const pkgPath = join(repoPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return "npm test";
      }
    } catch {}
  }

  if (existsSync(join(repoPath, "Cargo.toml"))) {
    return "cargo test";
  }

  if (existsSync(join(repoPath, "go.mod"))) {
    return "go test ./...";
  }

  if (existsSync(join(repoPath, "pyproject.toml")) || existsSync(join(repoPath, "pytest.ini"))) {
    return "pytest";
  }

  if (existsSync(join(repoPath, "Makefile"))) {
    try {
      const makefile = readFileSync(join(repoPath, "Makefile"), "utf-8");
      if (makefile.includes("test:")) {
        return "make test";
      }
    } catch {}
  }

  return null;
}

export function runTests(
  repoPath: string,
  sessionId: string,
): TestResult {
  const command = detectTestCommand(repoPath);

  if (!command) {
    return {
      passed: true,
      output: "No test command detected, skipping tests.",
      command: "(none)",
    };
  }

  addMessage(sessionId, "system", `Running tests: ${command}`);

  try {
    const output = execSync(command, {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return { passed: true, output, command };
  } catch (err) {
    const output =
      err instanceof Error && "stdout" in err
        ? String((err as { stdout: string }).stdout)
        : String(err);

    return { passed: false, output, command };
  }
}

export function parseTestFailures(output: string): string[] {
  const failures: string[] = [];

  // Common patterns
  const failPatterns = [
    /FAIL\s+(.+)/g,
    /✗\s+(.+)/g,
    /FAILED\s+(.+)/g,
    /Error:\s+(.+)/g,
    /AssertionError:\s+(.+)/g,
  ];

  for (const pattern of failPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      failures.push(match[1].trim());
    }
  }

  return failures;
}
