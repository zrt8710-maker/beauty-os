import path from "node:path";

import { createKnowledgeCandidateFileWorkflow } from "@/server/product-facts/knowledge-candidate-file-workflow";

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const workflow = createKnowledgeCandidateFileWorkflow();
  const report = await workflow.run({
    inputFilePath: options.inputFilePath,
    outputFilePath: options.outputFilePath,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArguments(args: string[]) {
  let inputFilePath: string | null = null;
  let outputFilePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      inputFilePath = path.resolve(requiredValue(args, ++index, "--input"));
      continue;
    }
    if (argument === "--output") {
      outputFilePath = path.resolve(requiredValue(args, ++index, "--output"));
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (inputFilePath === null) throw new Error("必须提供 --input。");
  return { inputFilePath, outputFilePath };
}

function requiredValue(args: string[], index: number, option: string) {
  const value = args[index];
  if (!value) throw new Error(`${option} 缺少参数值。`);
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`knowledge:candidate failed: ${message}\n`);
  process.exitCode = 1;
});
