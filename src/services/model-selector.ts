/**
 * Simple Model Selector for Local Node
 *
 * Selects the best available model from local Ollama.
 */

// Task categories
export type TaskCategory = 'coding' | 'general' | 'analysis' | 'creative' | 'math';

// Model selection result
export interface ModelSelectionResult {
  model: string;
  reason: string;
  nodeId?: string;
}

// Node model info
interface NodeModel {
  name: string;
  size: number;
  quantization?: string;
}

interface LocalNode {
  id: string;
  name: string;
  models: NodeModel[];
}

// Keywords for task categorization
const TASK_KEYWORDS: Record<TaskCategory, string[]> = {
  coding: ['code', 'programming', 'function', 'debug', 'fix', 'implement', 'refactor', 'bug', 'error', 'script', 'api', 'class', 'method'],
  analysis: ['analyze', 'explain', 'understand', 'review', 'examine', 'investigate', 'evaluate', 'assess'],
  math: ['calculate', 'math', 'formula', 'equation', 'compute', 'solve', 'numeric', 'statistics'],
  creative: ['write', 'story', 'poem', 'creative', 'imagine', 'generate', 'compose', 'design'],
  general: [], // default
};

// Preferred models by category
const PREFERRED_MODELS: Record<TaskCategory, string[]> = {
  coding: ['qwen2.5-coder', 'deepseek-coder', 'codellama', 'llama3.2', 'llama3.1'],
  analysis: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5'],
  math: ['qwen2.5', 'llama3.2', 'llama3.1', 'mistral'],
  creative: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5'],
  general: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5'],
};

/**
 * Categorize a task based on keywords
 */
function categorizeTask(goal: string): TaskCategory {
  const lowerGoal = goal.toLowerCase();

  for (const [category, keywords] of Object.entries(TASK_KEYWORDS)) {
    if (keywords.some(kw => lowerGoal.includes(kw))) {
      return category as TaskCategory;
    }
  }

  return 'general';
}

/**
 * Select the best model for a task from available nodes
 */
export function selectModel(
  goal: string,
  nodes: LocalNode[],
  preferredModel?: string
): ModelSelectionResult {
  const category = categorizeTask(goal);

  // If a preferred model is specified, try to use it
  if (preferredModel) {
    for (const node of nodes) {
      const model = node.models.find(m => m.name === preferredModel);
      if (model) {
        return {
          model: model.name,
          reason: `Using specified model ${model.name}`,
          nodeId: node.id,
        };
      }
    }
  }

  // Get preferred model families for this task category
  const preferredFamilies = PREFERRED_MODELS[category];

  // Try to find a model from preferred families
  for (const family of preferredFamilies) {
    for (const node of nodes) {
      const model = node.models.find(m => m.name.startsWith(family));
      if (model) {
        return {
          model: model.name,
          reason: `Using ${model.name} for ${category} task`,
          nodeId: node.id,
        };
      }
    }
  }

  // Fall back to any available model
  for (const node of nodes) {
    if (node.models.length > 0) {
      const model = node.models[0];
      return {
        model: model.name,
        reason: `Using available model ${model.name}`,
        nodeId: node.id,
      };
    }
  }

  // No models available
  return {
    model: 'llama3.2:3b',
    reason: 'No models available, defaulting to llama3.2:3b',
  };
}

export default { selectModel, categorizeTask };
