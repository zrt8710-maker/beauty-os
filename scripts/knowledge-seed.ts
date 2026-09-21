import { readdir } from "node:fs/promises";
import path from "node:path";

import type {
  ProductKnowledgeSeedFiles,
  ProductKnowledgeSeedMode,
  ProductKnowledgeSeedWorkflow,
} from "@/server/services/product-knowledge-seed-workflow";
import { createProductKnowledgeSeedWorkflow } from "@/server/services/product-knowledge-seed-workflow";

const APPLY_CONFIRMATION = "APPLY_VERIFIED_KNOWLEDGE";

type CliOptions = {
  mode: ProductKnowledgeSeedMode;
  directory: string;
  productKey: string | null;
  confirmation: string | null;
};

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const pairs = await discoverPairs(options.directory, options.productKey);
  const workflow = await createWorkflow(options.mode);
  const reports = [];

  for (const pair of pairs) {
    const report = await workflow.run(pair, { mode: options.mode });
    reports.push(report);
    if (options.mode === "apply" && !report.success) break;
  }

  const output = {
    mode: options.mode,
    success: reports.length > 0 && reports.every((report) => report.success),
    processed: reports.length,
    reports,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.success) process.exitCode = 1;
}

function parseArguments(args: string[]): CliOptions {
  let mode: ProductKnowledgeSeedMode = "dry-run";
  let modeWasSet = false;
  let directory = path.resolve("knowledge-data/product-seed");
  let productKey: string | null = null;
  let confirmation: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--validate", "--dry-run", "--apply"].includes(argument)) {
      if (modeWasSet) throw new Error("只能指定一种执行模式。");
      mode = argument.slice(2) as ProductKnowledgeSeedMode;
      modeWasSet = true;
      continue;
    }

    if (argument === "--dir") {
      directory = path.resolve(requiredValue(args, ++index, "--dir"));
      continue;
    }
    if (argument === "--product") {
      productKey = requiredValue(args, ++index, "--product");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(productKey)) {
        throw new Error("--product 只允许小写字母、数字和连字符。");
      }
      continue;
    }
    if (argument === "--confirm") {
      confirmation = requiredValue(args, ++index, "--confirm");
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (mode === "apply" && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(
      `apply 必须同时提供 --confirm ${APPLY_CONFIRMATION}。`,
    );
  }

  return { mode, directory, productKey, confirmation };
}

async function discoverPairs(
  directory: string,
  productKey: string | null,
): Promise<ProductKnowledgeSeedFiles[]> {
  if (productKey) {
    return [{
      productKey,
      identityFilePath: path.join(directory, `${productKey}.identity.json`),
      knowledgeFilePath: path.join(directory, `${productKey}.knowledge.json`),
    }];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const keys = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".identity.json"))
    .map((entry) => entry.name.slice(0, -".identity.json".length))
    .filter((key) => /^[a-z0-9][a-z0-9-]*$/.test(key))
    .sort();

  if (keys.length === 0) {
    throw new Error(`没有找到 Seed identity 文件：${directory}`);
  }

  return keys.map((key) => ({
    productKey: key,
    identityFilePath: path.join(directory, `${key}.identity.json`),
    knowledgeFilePath: path.join(directory, `${key}.knowledge.json`),
  }));
}

async function createWorkflow(
  mode: ProductKnowledgeSeedMode,
): Promise<ProductKnowledgeSeedWorkflow> {
  if (mode === "validate") return createProductKnowledgeSeedWorkflow();
  const { createAdminProductKnowledgeSeedWorkflow } = await import(
    "@/server/knowledge-seed/product-knowledge-seed-composition"
  );
  return createAdminProductKnowledgeSeedWorkflow();
}

function requiredValue(args: string[], index: number, option: string) {
  const value = args[index];
  if (!value) throw new Error(`${option} 缺少参数值。`);
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`knowledge:seed failed: ${message}\n`);
  process.exitCode = 1;
});
