import path from "node:path";

import { createProductKnowledgeReviewFileWorkflow } from "@/server/product-facts/product-knowledge-review-file-workflow";

type Action = "prepare" | "validate" | "compile";

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const workflow = createProductKnowledgeReviewFileWorkflow();

  if (options.action === "prepare") {
    const report = await workflow.prepare({
      candidateFilePath: options.candidateFilePath,
      reviewFilePath: options.reviewFilePath,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (options.reviewFilePath === undefined) {
    throw new Error(`${options.action} 必须提供 --review。`);
  }
  if (options.action === "validate") {
    const report = await workflow.validate({
      candidateFilePath: options.candidateFilePath,
      reviewFilePath: options.reviewFilePath,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.success) process.exitCode = 1;
    return;
  }

  const report = await workflow.compile({
    candidateFilePath: options.candidateFilePath,
    reviewFilePath: options.reviewFilePath,
    outputDirectory: options.outputDirectory,
    productKey: options.productKey,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArguments(args: string[]) {
  let action: Action | null = null;
  let candidateFilePath: string | null = null;
  let reviewFilePath: string | undefined;
  let outputDirectory: string | undefined;
  let productKey: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--prepare" || argument === "--validate"
        || argument === "--compile") {
      if (action !== null) throw new Error("只能选择一个操作模式。");
      action = argument.slice(2) as Action;
      continue;
    }
    if (argument === "--candidate") {
      candidateFilePath = path.resolve(
        requiredValue(args, ++index, "--candidate"),
      );
      continue;
    }
    if (argument === "--review") {
      reviewFilePath = path.resolve(requiredValue(args, ++index, "--review"));
      continue;
    }
    if (argument === "--output-dir") {
      outputDirectory = path.resolve(
        requiredValue(args, ++index, "--output-dir"),
      );
      continue;
    }
    if (argument === "--product-key") {
      productKey = requiredValue(args, ++index, "--product-key");
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (action === null) throw new Error("必须提供 --prepare、--validate 或 --compile。");
  if (candidateFilePath === null) throw new Error("必须提供 --candidate。");
  if (action !== "compile" && (outputDirectory || productKey)) {
    throw new Error("--output-dir 和 --product-key 只可用于 --compile。");
  }
  return {
    action,
    candidateFilePath,
    reviewFilePath,
    outputDirectory,
    productKey,
  };
}

function requiredValue(args: string[], index: number, option: string) {
  const value = args[index];
  if (!value) throw new Error(`${option} 缺少参数值。`);
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`knowledge:review failed: ${message}\n`);
  process.exitCode = 1;
});
