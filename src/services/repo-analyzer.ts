/**
 * Repository Analyzer Service
 *
 * Analyzes git repositories to generate developer onboarding documentation,
 * health reports, and architecture diagrams. Based on the on-bored tool.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

// ============ Types ============

export interface Contributor {
  name: string;
  commits: number;
  focus: string;
  expertise: string;
  topAreas: string[];
  radarData: Record<string, number>;
}

export interface TechStackItem {
  name: string;
  type: 'framework' | 'language' | 'database' | 'tool' | 'library' | 'infrastructure';
  version?: string;
}

export interface FileChange {
  file: string;
  changes: number;
}

export interface MonthlyActivity {
  label: string;
  year: number;
  total: number;
  fixes: number;
}

export interface ApiEndpoint {
  name: string;
  method: string;
  path: string;
  file: string;
}

export interface Component {
  name: string;
  path: string;
  type: 'vue' | 'react' | 'svelte' | 'astro' | 'other';
  size: number;
}

export interface DeadCodeReport {
  unusedComponents: Array<{ component: string; reason: string }>;
  unusedExports: Array<{ export: string; file: string }>;
  unusedFiles: Array<{ file: string; reason: string }>;
}

export interface SecurityIssue {
  type: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  description: string;
  category: string;
}

export interface MermaidFlow {
  name: string;
  type: 'auth' | 'payment' | 'data' | 'storage' | 'api' | 'deployment';
  diagram: string;
  description: string;
}

export interface RepoAnalysis {
  // Basic info
  repoName: string;
  repoPath: string;
  remoteUrl: string;
  currentBranch: string;
  firstCommitDate: string;
  latestCommitDate: string;

  // Statistics
  totalCommits: number;
  totalFixCommits: number;
  fixRatio: number;
  primaryLanguage: string;

  // People
  contributors: Contributor[];

  // Technical
  techStack: TechStackItem[];
  topFiles: FileChange[];
  monthlyActivity: MonthlyActivity[];

  // Code structure
  apiEndpoints: ApiEndpoint[];
  components: Component[];
  modules: Array<{ name: string; path: string; description: string }>;
  functions: Array<{ name: string; file: string; exported: boolean }>;
  envVars: string[];

  // Health
  deadCode?: DeadCodeReport;
  security?: { vulnerabilities: SecurityIssue[] };

  // Documentation
  projectDescription?: string;
  readme?: string;

  // Mermaid flows
  flows?: MermaidFlow[];

  // AI-enhanced (optional)
  ai?: {
    summary?: string;
    projectType?: string;
    keyThings?: string[];
    gotchas?: string[];
    architecture?: {
      pattern: string;
      description: string;
      keyDirectories: string[];
      dataFlow: string;
    };
    quickStart?: {
      setup: string[];
      firstTask: string;
      keyFiles: string[];
    };
  };

  // Meta
  analyzedAt: string;
  analysisDuration: number;
}

// ============ Helper Functions ============

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

function countLines(output: string): number {
  if (!output) return 0;
  return output.split('\n').filter(l => l.trim()).length;
}

function detectTechStack(repoPath: string): TechStackItem[] {
  const stack: TechStackItem[] = [];
  const packageJsonPath = path.join(repoPath, 'package.json');

  // Check package.json
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Frameworks
      if (allDeps['astro']) stack.push({ name: 'Astro', type: 'framework', version: allDeps['astro'] });
      if (allDeps['next']) stack.push({ name: 'Next.js', type: 'framework', version: allDeps['next'] });
      if (allDeps['nuxt']) stack.push({ name: 'Nuxt', type: 'framework', version: allDeps['nuxt'] });
      if (allDeps['vue']) stack.push({ name: 'Vue', type: 'framework', version: allDeps['vue'] });
      if (allDeps['react']) stack.push({ name: 'React', type: 'framework', version: allDeps['react'] });
      if (allDeps['svelte']) stack.push({ name: 'Svelte', type: 'framework', version: allDeps['svelte'] });
      if (allDeps['express']) stack.push({ name: 'Express', type: 'framework', version: allDeps['express'] });

      // Databases
      if (allDeps['prisma']) stack.push({ name: 'Prisma', type: 'database', version: allDeps['prisma'] });
      if (allDeps['mongoose']) stack.push({ name: 'MongoDB', type: 'database' });
      if (allDeps['pg']) stack.push({ name: 'PostgreSQL', type: 'database' });
      if (allDeps['appwrite']) stack.push({ name: 'Appwrite', type: 'database', version: allDeps['appwrite'] });

      // Tools
      if (allDeps['typescript']) stack.push({ name: 'TypeScript', type: 'language', version: allDeps['typescript'] });
      if (allDeps['tailwindcss']) stack.push({ name: 'Tailwind CSS', type: 'tool', version: allDeps['tailwindcss'] });
      if (allDeps['stripe']) stack.push({ name: 'Stripe', type: 'library', version: allDeps['stripe'] });
      if (allDeps['vitest']) stack.push({ name: 'Vitest', type: 'tool', version: allDeps['vitest'] });
      if (allDeps['jest']) stack.push({ name: 'Jest', type: 'tool', version: allDeps['jest'] });

      // Infrastructure
      if (allDeps['@astrojs/cloudflare'] || allDeps['wrangler']) stack.push({ name: 'Cloudflare Workers', type: 'infrastructure' });
      if (allDeps['@vercel/node']) stack.push({ name: 'Vercel', type: 'infrastructure' });
    } catch {
      // Ignore parse errors
    }
  }

  // Check Cargo.toml (Rust)
  if (existsSync(path.join(repoPath, 'Cargo.toml'))) {
    stack.push({ name: 'Rust', type: 'language' });
  }

  // Check requirements.txt (Python)
  if (existsSync(path.join(repoPath, 'requirements.txt'))) {
    stack.push({ name: 'Python', type: 'language' });
  }

  // Check go.mod (Go)
  if (existsSync(path.join(repoPath, 'go.mod'))) {
    stack.push({ name: 'Go', type: 'language' });
  }

  return stack;
}

function findApiEndpoints(repoPath: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const apiDirs = ['src/pages/api', 'pages/api', 'api', 'src/api', 'src/routes'];

  for (const dir of apiDirs) {
    const apiPath = path.join(repoPath, dir);
    if (existsSync(apiPath)) {
      scanApiDir(apiPath, dir, endpoints);
    }
  }

  return endpoints.slice(0, 50); // Limit to 50
}

function scanApiDir(dirPath: string, basePath: string, endpoints: ApiEndpoint[]): void {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanApiDir(fullPath, path.join(basePath, entry.name), endpoints);
      } else if (entry.isFile() && /\.(ts|js|json)$/.test(entry.name)) {
        const routePath = path.join(basePath, entry.name)
          .replace(/\\/g, '/')
          .replace(/\.(ts|js|json)$/, '')
          .replace(/\/index$/, '');

        endpoints.push({
          name: entry.name.replace(/\.(ts|js|json)$/, ''),
          method: 'ALL',
          path: '/' + routePath,
          file: fullPath,
        });
      }
    }
  } catch {
    // Ignore errors
  }
}

function findComponents(repoPath: string): Component[] {
  const components: Component[] = [];
  const componentDirs = ['src/components', 'components', 'src/app', 'app'];

  for (const dir of componentDirs) {
    const compPath = path.join(repoPath, dir);
    if (existsSync(compPath)) {
      scanComponentDir(compPath, components);
    }
  }

  return components.slice(0, 100); // Limit to 100
}

function scanComponentDir(dirPath: string, components: Component[]): void {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanComponentDir(fullPath, components);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        let type: Component['type'] = 'other';

        if (ext === '.vue') type = 'vue';
        else if (ext === '.tsx' || ext === '.jsx') type = 'react';
        else if (ext === '.svelte') type = 'svelte';
        else if (ext === '.astro') type = 'astro';
        else continue; // Skip non-component files

        const stats = statSync(fullPath);
        components.push({
          name: entry.name.replace(/\.[^.]+$/, ''),
          path: fullPath,
          type,
          size: stats.size,
        });
      }
    }
  } catch {
    // Ignore errors
  }
}

function detectPrimaryLanguage(repoPath: string): string {
  const extensions: Record<string, number> = {};

  function countFiles(dir: string, depth = 0): void {
    if (depth > 5) return; // Limit depth
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          countFiles(fullPath, depth + 1);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.ts', '.js', '.vue', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb'].includes(ext)) {
            extensions[ext] = (extensions[ext] || 0) + 1;
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  countFiles(repoPath);

  const sorted = Object.entries(extensions).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'Unknown';

  const extToLang: Record<string, string> = {
    '.ts': 'TypeScript',
    '.js': 'JavaScript',
    '.vue': 'Vue',
    '.tsx': 'TypeScript (React)',
    '.jsx': 'JavaScript (React)',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.rb': 'Ruby',
  };

  return extToLang[sorted[0][0]] || 'Unknown';
}

function findEnvVars(repoPath: string): string[] {
  const envVars = new Set<string>();

  // Check .env.example, .env.sample
  const envFiles = ['.env.example', '.env.sample', '.env.template'];
  for (const file of envFiles) {
    const envPath = path.join(repoPath, file);
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      const matches = content.match(/^[A-Z][A-Z0-9_]*/gm);
      if (matches) matches.forEach(m => envVars.add(m));
    }
  }

  // Check env.ts or similar
  const envTsFiles = ['src/env.ts', 'env.ts', 'src/config/env.ts'];
  for (const file of envTsFiles) {
    const envPath = path.join(repoPath, file);
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      const matches = content.match(/[A-Z][A-Z0-9_]{2,}/g);
      if (matches) matches.forEach(m => envVars.add(m));
    }
  }

  return Array.from(envVars).slice(0, 50);
}

function getReadmeContent(repoPath: string): string | undefined {
  const readmeFiles = ['README.md', 'readme.md', 'README.MD', 'Readme.md'];
  for (const file of readmeFiles) {
    const readmePath = path.join(repoPath, file);
    if (existsSync(readmePath)) {
      return readFileSync(readmePath, 'utf-8');
    }
  }
  return undefined;
}

// ============ Mermaid Flow Generation ============

function generateMermaidFlows(analysis: Partial<RepoAnalysis>): MermaidFlow[] {
  const flows: MermaidFlow[] = [];

  // API Overview Flow
  if (analysis.apiEndpoints && analysis.apiEndpoints.length > 0) {
    const apiGroups: Record<string, string[]> = {};
    analysis.apiEndpoints.forEach(ep => {
      const category = ep.path.split('/')[2] || 'other';
      if (!apiGroups[category]) apiGroups[category] = [];
      apiGroups[category].push(ep.name);
    });

    let diagram = 'flowchart LR\n';
    diagram += '  Client[Client] --> API[API Gateway]\n';

    Object.entries(apiGroups).forEach(([category, endpoints], i) => {
      diagram += `  API --> ${category}["${category}"]\n`;
      endpoints.slice(0, 3).forEach((ep, j) => {
        diagram += `  ${category} --> ${category}${j}["${ep}"]\n`;
      });
    });

    flows.push({
      name: 'API Overview',
      type: 'api',
      diagram,
      description: `${analysis.apiEndpoints.length} API endpoints across ${Object.keys(apiGroups).length} categories`,
    });
  }

  // Component Architecture Flow
  if (analysis.components && analysis.components.length > 0) {
    const componentsByType: Record<string, number> = {};
    analysis.components.forEach(c => {
      componentsByType[c.type] = (componentsByType[c.type] || 0) + 1;
    });

    let diagram = 'flowchart TD\n';
    diagram += '  App[Application]\n';

    Object.entries(componentsByType).forEach(([type, count]) => {
      diagram += `  App --> ${type}["${type} (${count})"]\n`;
    });

    flows.push({
      name: 'Component Architecture',
      type: 'data',
      diagram,
      description: `${analysis.components.length} components across ${Object.keys(componentsByType).length} types`,
    });
  }

  // Tech Stack Flow
  if (analysis.techStack && analysis.techStack.length > 0) {
    let diagram = 'flowchart LR\n';
    diagram += '  subgraph Frontend\n';
    analysis.techStack.filter(t => ['framework', 'tool'].includes(t.type) && ['Vue', 'React', 'Astro', 'Svelte', 'Tailwind CSS'].includes(t.name))
      .forEach(t => { diagram += `    ${t.name.replace(/\s/g, '')}["${t.name}"]\n`; });
    diagram += '  end\n';

    diagram += '  subgraph Backend\n';
    analysis.techStack.filter(t => t.type === 'database' || ['Express', 'Appwrite'].includes(t.name))
      .forEach(t => { diagram += `    ${t.name.replace(/\s/g, '')}["${t.name}"]\n`; });
    diagram += '  end\n';

    diagram += '  subgraph Infrastructure\n';
    analysis.techStack.filter(t => t.type === 'infrastructure')
      .forEach(t => { diagram += `    ${t.name.replace(/\s/g, '')}["${t.name}"]\n`; });
    diagram += '  end\n';

    diagram += '  Frontend --> Backend\n';
    diagram += '  Backend --> Infrastructure\n';

    flows.push({
      name: 'Tech Stack',
      type: 'deployment',
      diagram,
      description: `${analysis.techStack.length} technologies in use`,
    });
  }

  return flows;
}

// ============ Main Analysis Function ============

export async function analyzeRepository(repoPath: string): Promise<RepoAnalysis> {
  const startTime = Date.now();

  // Verify git repo
  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' });
  } catch {
    throw new Error('Not a git repository');
  }

  console.log(`[RepoAnalyzer] Analyzing ${repoPath}...`);

  // Basic info
  const repoName = path.basename(path.resolve(repoPath));
  const remoteUrl = git('remote get-url origin', repoPath) || 'No remote';
  const currentBranch = git('branch --show-current', repoPath) || 'main';
  const firstCommitDate = git('log --reverse --format=%ci', repoPath).split('\n')[0] || '';
  const latestCommitDate = git('log -1 --format=%ci', repoPath) || '';

  // Commit stats
  const totalCommits = countLines(git('log --oneline', repoPath));
  const totalFixCommits = countLines(git('log --oneline --grep=fix', repoPath));
  const fixRatio = totalCommits > 0 ? Math.round((totalFixCommits / totalCommits) * 100) : 0;

  // Contributors
  const contributorsRaw = git('shortlog -sn --all', repoPath)
    .split('\n')
    .filter(l => l.trim())
    .slice(0, 10)
    .map(line => {
      const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
      return match ? { commits: parseInt(match[1]), name: match[2] } : null;
    })
    .filter(Boolean) as Array<{ commits: number; name: string }>;

  const contributors: Contributor[] = contributorsRaw.map(c => ({
    ...c,
    focus: 'general',
    expertise: 'general',
    topAreas: [],
    radarData: {},
  }));

  // Top changed files
  const topFilesRaw = git('log --pretty=format: --name-only', repoPath)
    .split('\n')
    .filter(l => l.trim());

  const fileCounts: Record<string, number> = {};
  topFilesRaw.forEach(file => {
    fileCounts[file] = (fileCounts[file] || 0) + 1;
  });

  const topFiles: FileChange[] = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, changes]) => ({ file, changes }));

  // Monthly activity (last 6 months)
  const monthlyActivity: MonthlyActivity[] = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const nextDate = new Date(date);
    nextDate.setMonth(nextDate.getMonth() + 1);
    const nextYear = nextDate.getFullYear();
    const nextMonth = String(nextDate.getMonth() + 1).padStart(2, '0');

    const total = countLines(git(`log --oneline --after="${year}-${month}-01" --before="${nextYear}-${nextMonth}-01"`, repoPath));
    const fixes = countLines(git(`log --oneline --after="${year}-${month}-01" --before="${nextYear}-${nextMonth}-01" --grep=fix`, repoPath));

    monthlyActivity.push({
      label: date.toLocaleString('default', { month: 'short' }),
      year,
      total,
      fixes,
    });
  }

  // Technical analysis
  const techStack = detectTechStack(repoPath);
  const primaryLanguage = detectPrimaryLanguage(repoPath);
  const apiEndpoints = findApiEndpoints(repoPath);
  const components = findComponents(repoPath);
  const envVars = findEnvVars(repoPath);
  const readme = getReadmeContent(repoPath);

  // Build analysis object
  const analysis: RepoAnalysis = {
    repoName,
    repoPath,
    remoteUrl,
    currentBranch,
    firstCommitDate,
    latestCommitDate,
    totalCommits,
    totalFixCommits,
    fixRatio,
    primaryLanguage,
    contributors,
    techStack,
    topFiles,
    monthlyActivity,
    apiEndpoints,
    components,
    modules: [],
    functions: [],
    envVars,
    readme,
    projectDescription: readme?.split('\n').slice(0, 5).join('\n'),
    analyzedAt: new Date().toISOString(),
    analysisDuration: Date.now() - startTime,
  };

  // Generate Mermaid flows
  analysis.flows = generateMermaidFlows(analysis);

  console.log(`[RepoAnalyzer] Analysis complete in ${analysis.analysisDuration}ms`);

  return analysis;
}

// Singleton for caching
class RepoAnalyzerService {
  private cache = new Map<string, { analysis: RepoAnalysis; timestamp: number }>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  async analyze(repoPath: string, force = false): Promise<RepoAnalysis> {
    const cached = this.cache.get(repoPath);
    if (!force && cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.analysis;
    }

    const analysis = await analyzeRepository(repoPath);
    this.cache.set(repoPath, { analysis, timestamp: Date.now() });

    return analysis;
  }

  clearCache(repoPath?: string): void {
    if (repoPath) {
      this.cache.delete(repoPath);
    } else {
      this.cache.clear();
    }
  }
}

export const RepoAnalyzer = new RepoAnalyzerService();
