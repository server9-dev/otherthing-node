/**
 * UAF Views - Diagram generation for UAF elements
 * Generates Mermaid diagrams for different viewpoints and model kinds
 */

import {
  UAFElement,
  UAFRelationship,
  UAFViewpoint,
  UAFModelKind,
  UAF_VIEWPOINTS,
  UAF_MODEL_KINDS,
} from './uaf-types';
import { uafService } from './uaf-service';

export type DiagramType =
  | 'flowchart'
  | 'classDiagram'
  | 'stateDiagram'
  | 'sequenceDiagram'
  | 'erDiagram'
  | 'mindmap'
  | 'timeline'
  | 'gantt';

interface ViewGeneratorOptions {
  workspaceId: string;
  viewpoint?: UAFViewpoint;
  modelKind?: UAFModelKind;
  elementIds?: string[];
  includeRelationships?: boolean;
  maxDepth?: number;
}

class UAFViewGenerator {
  /**
   * Generate a Mermaid diagram for the specified view
   */
  async generateView(options: ViewGeneratorOptions): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId: options.workspaceId,
      viewpoint: options.viewpoint,
      modelKind: options.modelKind,
    });

    const relationships = options.includeRelationships !== false
      ? await uafService.queryRelationships({ workspaceId: options.workspaceId })
      : [];

    // Filter relationships to only include those between our elements
    const elementIds = new Set(elements.map(e => e.id));
    const relevantRels = relationships.filter(
      r => elementIds.has(r.sourceId) && elementIds.has(r.targetId)
    );

    // Choose diagram type based on viewpoint and model kind
    const diagramType = this.selectDiagramType(options.viewpoint, options.modelKind);

    return this.generateMermaid(diagramType, elements, relevantRels, options);
  }

  /**
   * Generate capability taxonomy (Strategic-Taxonomy)
   */
  async generateCapabilityTaxonomy(workspaceId: string): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint: 'strategic',
      modelKind: 'taxonomy',
    });

    const relationships = await uafService.queryRelationships({ workspaceId });
    const composeRels = relationships.filter(r => r.relationshipType === 'composes');

    let mermaid = 'mindmap\n  root((Capabilities))\n';

    // Build hierarchy
    const children = new Map<string, UAFElement[]>();
    const roots: UAFElement[] = [];

    for (const element of elements) {
      const parentRel = composeRels.find(r => r.targetId === element.id);
      if (parentRel) {
        const parentChildren = children.get(parentRel.sourceId) || [];
        parentChildren.push(element);
        children.set(parentRel.sourceId, parentChildren);
      } else {
        roots.push(element);
      }
    }

    // Render hierarchy
    const renderElement = (element: UAFElement, depth: number): string => {
      const indent = '  '.repeat(depth + 1);
      let result = `${indent}${this.sanitize(element.name)}\n`;
      const elementChildren = children.get(element.id) || [];
      for (const child of elementChildren) {
        result += renderElement(child, depth + 1);
      }
      return result;
    };

    for (const root of roots) {
      mermaid += renderElement(root, 1);
    }

    return mermaid;
  }

  /**
   * Generate operational activity flow (Operational-Processes)
   */
  async generateOperationalFlow(workspaceId: string): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint: 'operational',
      modelKind: 'processes',
    });

    const relationships = await uafService.queryRelationships({ workspaceId });

    let mermaid = 'flowchart TD\n';

    // Add nodes
    for (const element of elements) {
      const shape = element.elementType === 'operational_performer' ? '([' : '[';
      const shapeEnd = element.elementType === 'operational_performer' ? '])' : ']';
      mermaid += `  ${this.toId(element.id)}${shape}"${this.sanitize(element.name)}"${shapeEnd}\n`;
    }

    // Add edges
    const elementIds = new Set(elements.map(e => e.id));
    for (const rel of relationships) {
      if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
        const label = rel.name || rel.relationshipType;
        mermaid += `  ${this.toId(rel.sourceId)} -->|${this.sanitize(label)}| ${this.toId(rel.targetId)}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generate resource structure (Resources-Structure)
   */
  async generateResourceStructure(workspaceId: string): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint: 'resources',
      modelKind: 'structure',
    });

    const relationships = await uafService.queryRelationships({ workspaceId });

    let mermaid = 'classDiagram\n';

    // Add classes
    for (const element of elements) {
      mermaid += `  class ${this.toId(element.id)} {\n`;
      mermaid += `    <<${element.elementType}>>\n`;
      mermaid += `    ${this.sanitize(element.name)}\n`;

      // Add properties
      if (element.properties) {
        for (const [key, value] of Object.entries(element.properties)) {
          if (typeof value === 'string' || typeof value === 'number') {
            mermaid += `    +${key}: ${value}\n`;
          }
        }
      }
      mermaid += `  }\n`;
    }

    // Add relationships
    const elementIds = new Set(elements.map(e => e.id));
    for (const rel of relationships) {
      if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
        const arrow = this.getClassDiagramArrow(rel.relationshipType);
        mermaid += `  ${this.toId(rel.sourceId)} ${arrow} ${this.toId(rel.targetId)}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generate state diagram (any viewpoint with States model kind)
   */
  async generateStateDiagram(workspaceId: string, viewpoint: UAFViewpoint): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint,
      modelKind: 'states',
    });

    const relationships = await uafService.queryRelationships({ workspaceId });

    let mermaid = 'stateDiagram-v2\n';

    // Add states
    for (const element of elements) {
      mermaid += `  ${this.toId(element.id)} : ${this.sanitize(element.name)}\n`;
    }

    // Add transitions
    const elementIds = new Set(elements.map(e => e.id));
    for (const rel of relationships) {
      if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
        const label = rel.name || rel.relationshipType;
        mermaid += `  ${this.toId(rel.sourceId)} --> ${this.toId(rel.targetId)} : ${this.sanitize(label)}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generate project timeline (Projects-Roadmap)
   */
  async generateProjectTimeline(workspaceId: string): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint: 'projects',
      modelKind: 'roadmap',
    });

    let mermaid = 'gantt\n';
    mermaid += '  title Project Roadmap\n';
    mermaid += '  dateFormat YYYY-MM-DD\n';

    // Group by project
    const projects = elements.filter(e => e.elementType === 'project');
    const milestones = elements.filter(e => e.elementType === 'milestone');

    for (const project of projects) {
      mermaid += `  section ${this.sanitize(project.name)}\n`;

      // Find milestones for this project
      const projectMilestones = milestones.filter(
        m => m.properties.projectId === project.id
      );

      for (const milestone of projectMilestones) {
        const start = milestone.properties.startDate || '2024-01-01';
        const end = milestone.properties.endDate || '2024-12-31';
        mermaid += `    ${this.sanitize(milestone.name)} : ${start}, ${end}\n`;
      }

      // If no milestones, show project duration
      if (projectMilestones.length === 0) {
        const start = project.properties.startDate || '2024-01-01';
        const end = project.properties.endDate || '2024-12-31';
        mermaid += `    ${this.sanitize(project.name)} : ${start}, ${end}\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generate sequence diagram (any viewpoint with Scenarios model kind)
   */
  async generateSequenceDiagram(workspaceId: string, viewpoint: UAFViewpoint): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint,
      modelKind: 'scenarios',
    });

    const relationships = await uafService.queryRelationships({ workspaceId });

    let mermaid = 'sequenceDiagram\n';

    // Add participants
    const performers = elements.filter(
      e => e.elementType === 'operational_performer' || e.elementType === 'system'
    );
    for (const performer of performers) {
      mermaid += `  participant ${this.toId(performer.id)} as ${this.sanitize(performer.name)}\n`;
    }

    // Add interactions (exchanges)
    const performerIds = new Set(performers.map(p => p.id));
    const exchanges = relationships.filter(
      r => r.relationshipType === 'exchanges' &&
           performerIds.has(r.sourceId) &&
           performerIds.has(r.targetId)
    );

    for (const exchange of exchanges) {
      const label = exchange.name || 'message';
      mermaid += `  ${this.toId(exchange.sourceId)}->>+${this.toId(exchange.targetId)}: ${this.sanitize(label)}\n`;
    }

    return mermaid;
  }

  /**
   * Generate entity-relationship diagram (Information model kind)
   */
  async generateInformationModel(workspaceId: string, viewpoint: UAFViewpoint): Promise<string> {
    const elements = await uafService.queryElements({
      workspaceId,
      viewpoint,
      modelKind: 'information',
    });

    const relationships = await uafService.queryRelationships({ workspaceId });

    let mermaid = 'erDiagram\n';

    // Add entities
    for (const element of elements) {
      mermaid += `  ${this.toId(element.id)} {\n`;
      if (element.properties) {
        for (const [key, value] of Object.entries(element.properties)) {
          const type = typeof value === 'string' ? 'string' : 'int';
          mermaid += `    ${type} ${key}\n`;
        }
      }
      mermaid += `  }\n`;
    }

    // Add relationships
    const elementIds = new Set(elements.map(e => e.id));
    for (const rel of relationships) {
      if (elementIds.has(rel.sourceId) && elementIds.has(rel.targetId)) {
        mermaid += `  ${this.toId(rel.sourceId)} ||--o{ ${this.toId(rel.targetId)} : "${this.sanitize(rel.relationshipType)}"\n`;
      }
    }

    return mermaid;
  }

  /**
   * Generate a grid overview showing all viewpoints and model kinds
   */
  async generateGridOverview(workspaceId: string): Promise<string> {
    const grid = await uafService.getGrid(workspaceId);

    let mermaid = 'flowchart TB\n';
    mermaid += '  subgraph UAF["UAF Architecture Grid"]\n';

    const viewpoints = Object.keys(UAF_VIEWPOINTS) as UAFViewpoint[];
    const modelKinds = Object.keys(UAF_MODEL_KINDS) as UAFModelKind[];

    for (const vp of viewpoints) {
      mermaid += `    subgraph ${vp}["${UAF_VIEWPOINTS[vp].name}"]\n`;

      const row = grid.find(r => r.length > 0 && r[0].viewpoint === vp);
      if (row) {
        for (const cell of row) {
          if (cell.elementCount > 0) {
            mermaid += `      ${vp}_${cell.modelKind}["${cell.viewCode}<br/>${cell.elementCount} elements"]\n`;
          }
        }
      }

      mermaid += `    end\n`;
    }

    mermaid += '  end\n';
    return mermaid;
  }

  // ============ HELPER METHODS ============

  private selectDiagramType(viewpoint?: UAFViewpoint, modelKind?: UAFModelKind): DiagramType {
    if (modelKind === 'taxonomy') return 'mindmap';
    if (modelKind === 'processes') return 'flowchart';
    if (modelKind === 'structure') return 'classDiagram';
    if (modelKind === 'states') return 'stateDiagram';
    if (modelKind === 'scenarios') return 'sequenceDiagram';
    if (modelKind === 'information') return 'erDiagram';
    if (modelKind === 'roadmap') return 'gantt';
    return 'flowchart';
  }

  private generateMermaid(
    type: DiagramType,
    elements: UAFElement[],
    relationships: UAFRelationship[],
    options: ViewGeneratorOptions
  ): string {
    switch (type) {
      case 'flowchart':
        return this.generateFlowchart(elements, relationships);
      case 'classDiagram':
        return this.generateClassDiagram(elements, relationships);
      case 'mindmap':
        return this.generateMindmap(elements, relationships);
      default:
        return this.generateFlowchart(elements, relationships);
    }
  }

  private generateFlowchart(elements: UAFElement[], relationships: UAFRelationship[]): string {
    let mermaid = 'flowchart TD\n';

    for (const element of elements) {
      mermaid += `  ${this.toId(element.id)}["${this.sanitize(element.name)}"]\n`;
    }

    for (const rel of relationships) {
      const label = rel.name || rel.relationshipType;
      mermaid += `  ${this.toId(rel.sourceId)} -->|${this.sanitize(label)}| ${this.toId(rel.targetId)}\n`;
    }

    return mermaid;
  }

  private generateClassDiagram(elements: UAFElement[], relationships: UAFRelationship[]): string {
    let mermaid = 'classDiagram\n';

    for (const element of elements) {
      mermaid += `  class ${this.toId(element.id)} {\n`;
      mermaid += `    <<${element.elementType}>>\n`;
      mermaid += `    ${this.sanitize(element.name)}\n`;
      mermaid += `  }\n`;
    }

    for (const rel of relationships) {
      const arrow = this.getClassDiagramArrow(rel.relationshipType);
      mermaid += `  ${this.toId(rel.sourceId)} ${arrow} ${this.toId(rel.targetId)}\n`;
    }

    return mermaid;
  }

  private generateMindmap(elements: UAFElement[], relationships: UAFRelationship[]): string {
    let mermaid = 'mindmap\n  root((Architecture))\n';

    for (const element of elements) {
      mermaid += `    ${this.sanitize(element.name)}\n`;
    }

    return mermaid;
  }

  private getClassDiagramArrow(relType: string): string {
    switch (relType) {
      case 'composes': return '*--';
      case 'specializes': return '<|--';
      case 'realizes': return '..|>';
      case 'associates': return '--';
      case 'requires': return '..>';
      default: return '-->';
    }
  }

  private toId(id: string): string {
    // Convert UUID to valid Mermaid ID
    return 'e_' + id.replace(/-/g, '_').substring(0, 16);
  }

  private sanitize(text: string): string {
    // Escape special characters for Mermaid
    return text
      .replace(/"/g, "'")
      .replace(/\n/g, ' ')
      .replace(/[<>]/g, '')
      .substring(0, 50);
  }
}

export const uafViewGenerator = new UAFViewGenerator();
