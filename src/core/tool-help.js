/**
 * ToolHelp — detailed help for each tool with examples
 */
import { COLORS } from './logger.js';

const TOOL_EXAMPLES = {
  ai: [
    '/call ai analyze {"path":"./src/index.js"}',
    '/call ai summarize {"path":"./src/index.js"}',
    '/call ai diff {"file1":"./old.js","file2":"./new.js"}',
  ],
  env: [
    '/call env get {"name":"HOME"}',
    '/call env list {"filter":"NODE"}',
  ],
  snippet: [
    '/call snippet save {"name":"hello","code":"console.log(1)","language":"js"}',
    '/call snippet load {"name":"hello"}',
    '/call snippet list',
  ],
  template: [
    '/call template list',
    '/call template create {"template":"node-basic","name":"my-app"}',
    '/call template info {"template":"python-basic"}',
  ],
  config: [
    '/call config list',
    '/call config get {"key":"tools.shell_timeout"}',
    '/call config set {"key":"tools.shell_timeout","value":"60000"}',
  ],
  diff: [
    '/call diff compare {"file1":"./old.js","file2":"./new.js"}',
    '/call diff stats {"file1":"./a.txt","file2":"./b.txt"}',
    '/call diff patch {"file1":"./a.py","file2":"./b.py"}',
  ],
  watch: [
    '/call watch start {"path":"./src"}',
    '/call watch stop {"path":"./src"}',
    '/call watch status',
  ],
  file: [
    '/call file read {"path":"./src/index.js"}',
    '/call file write {"path":"./test.js","content":"console.log(1)"}',
    '/call file edit {"path":"./src/index.js","old_text":"foo","new_text":"bar"}',
    '/call file list {"path":".","recursive":true}',
    '/call file exists {"path":"./package.json"}',
  ],
  shell: [
    '/call shell exec {"command":"npm test"}',
    '/call shell exec {"command":"ls -la","timeout":5000}',
    '/call shell ps {"filter":"node"}',
    '/call shell kill {"pid":1234}',
  ],
  git: [
    '/call git status',
    '/call git diff {"staged":true}',
    '/call git log {"limit":5}',
    '/call git commit {"message":"fix: bug"}',
    '/call git push',
  ],
  search: [
    '/call search grep {"pattern":"TODO","path":"./src"}',
    '/call search find {"name":"*.js","path":"./src"}',
    '/call search web {"url":"https://example.com"}',
  ],
  project: [
    '/call project info',
    '/call project build',
    '/call project test',
    '/call project lint',
    '/call project deps {"install":true}',
  ],
  process: [
    '/call process list',
    '/call process top {"limit":10}',
    '/call process info {"pid":1234}',
  ],
  network: [
    '/call network fetch {"url":"https://api.github.com"}',
    '/call network download {"url":"https://example.com/file.zip","path":"./file.zip"}',
    '/call network ping {"host":"google.com"}',
  ],
  env: [
    '/call env get {"name":"HOME"}',
    '/call env list {"filter":"NODE"}',
  ],
  ai: [
    '/call ai analyze {"path":"./src/index.js"}',
    '/call ai summarize {"path":"./src/index.js"}',
    '/call ai diff {"file1":"./old.js","file2":"./new.js"}',
  ],
};

export function showToolHelp(toolName) {
  const examples = TOOL_EXAMPLES[toolName];
  if (!examples) {
    console.log(`${COLORS.yellow}No help for: ${toolName}${COLORS.reset}`);
    console.log(`Available: ${Object.keys(TOOL_EXAMPLES).join(', ')}`);
    return;
  }

  console.log(`\n${COLORS.bold}📖 ${toolName} — Examples:${COLORS.reset}\n`);
  for (const ex of examples) {
    console.log(`  ${COLORS.cyan}${ex}${COLORS.reset}`);
  }
  console.log();
}

export function showAllToolHelp() {
  for (const [tool, examples] of Object.entries(TOOL_EXAMPLES)) {
    console.log(`\n${COLORS.bold}📖 ${tool}:${COLORS.reset}`);
    for (const ex of examples.slice(0, 2)) {
      console.log(`  ${COLORS.cyan}${ex}${COLORS.reset}`);
    }
  }
  console.log();
}
