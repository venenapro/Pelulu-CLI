/**
 * Template Tool — project scaffolding templates (1 MCP tool, 3 actions)
 * Actions: list, create, info
 */
import { writeFile, mkdir, readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getConfig } from '../core/config.js';
import { log } from '../core/logger.js';

const TEMPLATES = {
  'node-basic': {
    name: 'Node.js Basic',
    description: 'Basic Node.js project with package.json',
    files: {
      'package.json': '{\n  "name": "{{name}}",\n  "version": "1.0.0",\n  "type": "module",\n  "main": "index.js",\n  "scripts": {\n    "start": "node index.js",\n    "test": "echo \\"No tests\\""\n  }\n}',
      'index.js': '// {{name}}\nconsole.log("Hello!");\n',
      '.gitignore': 'node_modules/\n.env\n*.log\n',
      'README.md': '# {{name}}\n\nA new project.\n',
    },
  },
  'python-basic': {
    name: 'Python Basic',
    description: 'Basic Python project with venv',
    files: {
      'main.py': '# {{name}}\n\ndef main():\n    print("Hello!")\n\nif __name__ == "__main__":\n    main()\n',
      'requirements.txt': '',
      '.gitignore': '__pycache__/\n.venv/\n*.pyc\n.env\n',
      'README.md': '# {{name}}\n\nA new Python project.\n',
    },
  },
  'go-basic': {
    name: 'Go Basic',
    description: 'Basic Go project',
    files: {
      'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello!")\n}\n',
      'go.mod': 'module {{name}}\n\ngo 1.21\n',
      '.gitignore': '{{name}}\n*.exe\n',
      'README.md': '# {{name}}\n\nA new Go project.\n',
    },
  },
};

function applyTemplate(template, vars) {
  let content = TEMPLATES[template].files;
  const result = {};
  for (const [file, tpl] of Object.entries(content)) {
    result[file] = tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || key);
  }
  return result;
}

const ACTIONS = {
  list: {
    required: [],
    handler: async () => {
      const templates = Object.entries(TEMPLATES).map(([id, t]) => ({
        id, name: t.name, description: t.description, files: Object.keys(t.files).length,
      }));
      return { count: templates.length, templates };
    },
  },

  create: {
    required: ['template', 'name'],
    handler: async ({ template, name, path }) => {
      if (!TEMPLATES[template]) throw new Error(`Unknown template: ${template}. Use: ${Object.keys(TEMPLATES).join(', ')}`);
      const dir = path || join(getConfig().agent?.workspace || process.cwd(), name);
      await mkdir(dir, { recursive: true });
      const files = applyTemplate(template, { name });
      for (const [file, content] of Object.entries(files)) {
        await writeFile(join(dir, file), content);
      }
      log('template', `[DIR] Created ${template}: ${dir}`);
      return { created: true, template, path: dir, files: Object.keys(files) };
    },
  },

  info: {
    required: ['template'],
    handler: async ({ template }) => {
      if (!TEMPLATES[template]) throw new Error(`Unknown template: ${template}`);
      const t = TEMPLATES[template];
      return { id: template, name: t.name, description: t.description, files: Object.keys(t.files) };
    },
  },
};

const actionNames = Object.keys(ACTIONS);

export default {
  name: 'template',
  description: 'Project templates: list, create, info',
  actions: actionNames.map(name => ({ name, required: ACTIONS[name].required })),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: actionNames },
      template: { type: 'string', description: 'Template ID' },
      name: { type: 'string', description: 'Project name' },
      path: { type: 'string', description: 'Target directory' },
    },
    required: ['action'],
  },
  async handler({ action, ...params }) {
    const a = ACTIONS[action];
    if (!a) throw new Error(`Unknown action: ${action}`);
    for (const f of a.required) {
      if (params[f] === undefined) throw new Error(`Missing required: ${f}`);
    }
    return a.handler(params);
  },
};
