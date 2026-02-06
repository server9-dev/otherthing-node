/**
 * UAF Service - Core CRUD and operations for UAF architecture elements
 * Uses Appwrite for persistent storage
 */

import { v4 as uuidv4 } from 'uuid';
import { appwriteService, COLLECTIONS, DATABASE_ID } from './appwrite-service';
import {
  UAFElement,
  UAFRelationship,
  UAFView,
  UAFArchitecture,
  UAFGridCell,
  UAFViewpoint,
  UAFModelKind,
  UAFElementType,
  UAFRelationshipType,
  UAFElementFilter,
  UAFRelationshipFilter,
  UAFMetadata,
  UAF_VIEWPOINTS,
  UAF_MODEL_KINDS,
  UAFAnalysisRequest,
  UAFAnalysisResult,
} from './uaf-types';

class UAFService {
  // ============ ELEMENT CRUD ============

  /**
   * Create a new UAF element
   */
  async createElement(
    workspaceId: string,
    data: {
      name: string;
      description: string;
      viewpoint: UAFViewpoint;
      modelKind: UAFModelKind;
      elementType: UAFElementType;
      properties?: Record<string, any>;
      tags?: string[];
    },
    userId: string
  ): Promise<UAFElement> {
    const now = new Date().toISOString();
    const element: UAFElement = {
      id: uuidv4(),
      workspaceId,
      name: data.name,
      description: data.description,
      viewpoint: data.viewpoint,
      modelKind: data.modelKind,
      elementType: data.elementType,
      properties: data.properties || {},
      metadata: {
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        version: 1,
        tags: data.tags || [],
      },
    };

    // Store in Appwrite if available
    if (appwriteService.isInitialized()) {
      await appwriteService.createUAFElement(workspaceId, {
        name: element.name,
        description: element.description,
        viewpoint: element.viewpoint,
        modelKind: element.modelKind,
        elementType: element.elementType,
        properties: element.properties,
        createdBy: userId,
      });
    }

    // Also store locally
    this.storeElementLocally(element);

    return element;
  }

  /**
   * Get element by ID
   */
  async getElement(workspaceId: string, elementId: string): Promise<UAFElement | null> {
    // Try local first
    const local = this.getLocalElement(workspaceId, elementId);
    if (local) return local;

    // Try Appwrite
    if (appwriteService.isInitialized()) {
      try {
        const result = await appwriteService.queryUAFElements(workspaceId, {});
        const found = result.documents.find((d: any) => d.$id === elementId);
        if (found) {
          return this.documentToElement(found);
        }
      } catch (err) {
        console.error('[UAFService] Error fetching element:', err);
      }
    }

    return null;
  }

  /**
   * Update an element
   */
  async updateElement(
    workspaceId: string,
    elementId: string,
    updates: Partial<Omit<UAFElement, 'id' | 'workspaceId' | 'metadata'>>,
    userId: string
  ): Promise<UAFElement | null> {
    const element = await this.getElement(workspaceId, elementId);
    if (!element) return null;

    const updated: UAFElement = {
      ...element,
      ...updates,
      metadata: {
        ...element.metadata,
        updatedAt: new Date().toISOString(),
        version: element.metadata.version + 1,
      },
    };

    this.storeElementLocally(updated);
    return updated;
  }

  /**
   * Delete an element
   */
  async deleteElement(workspaceId: string, elementId: string): Promise<boolean> {
    // Remove from local storage
    const elements = this.getLocalElements(workspaceId);
    const filtered = elements.filter(e => e.id !== elementId);
    this.setLocalElements(workspaceId, filtered);

    // Also remove any relationships involving this element
    const relationships = this.getLocalRelationships(workspaceId);
    const filteredRels = relationships.filter(
      r => r.sourceId !== elementId && r.targetId !== elementId
    );
    this.setLocalRelationships(workspaceId, filteredRels);

    return true;
  }

  /**
   * Query elements with filters
   */
  async queryElements(filter: UAFElementFilter): Promise<UAFElement[]> {
    let elements = this.getLocalElements(filter.workspaceId || '');

    // Apply filters
    if (filter.viewpoint) {
      elements = elements.filter(e => e.viewpoint === filter.viewpoint);
    }
    if (filter.modelKind) {
      elements = elements.filter(e => e.modelKind === filter.modelKind);
    }
    if (filter.elementType) {
      elements = elements.filter(e => e.elementType === filter.elementType);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      elements = elements.filter(
        e =>
          e.name.toLowerCase().includes(search) ||
          e.description.toLowerCase().includes(search)
      );
    }
    if (filter.tags && filter.tags.length > 0) {
      elements = elements.filter(e =>
        filter.tags!.some(tag => e.metadata.tags?.includes(tag))
      );
    }

    // Pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    elements = elements.slice(offset, offset + limit);

    return elements;
  }

  // ============ RELATIONSHIP CRUD ============

  /**
   * Create a relationship between elements
   */
  async createRelationship(
    workspaceId: string,
    data: {
      sourceId: string;
      targetId: string;
      relationshipType: UAFRelationshipType;
      name?: string;
      description?: string;
      properties?: Record<string, any>;
    },
    userId: string
  ): Promise<UAFRelationship> {
    const now = new Date().toISOString();
    const relationship: UAFRelationship = {
      id: uuidv4(),
      workspaceId,
      sourceId: data.sourceId,
      targetId: data.targetId,
      relationshipType: data.relationshipType,
      name: data.name,
      description: data.description,
      properties: data.properties || {},
      metadata: {
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
    };

    // Store in Appwrite if available
    if (appwriteService.isInitialized()) {
      await appwriteService.createUAFRelationship({
        workspaceId,
        sourceId: relationship.sourceId,
        targetId: relationship.targetId,
        relationshipType: relationship.relationshipType,
        properties: relationship.properties,
        createdBy: userId,
      });
    }

    this.storeRelationshipLocally(relationship);
    return relationship;
  }

  /**
   * Get relationships for an element
   */
  async getElementRelationships(
    workspaceId: string,
    elementId: string
  ): Promise<{ incoming: UAFRelationship[]; outgoing: UAFRelationship[] }> {
    const relationships = this.getLocalRelationships(workspaceId);
    return {
      incoming: relationships.filter(r => r.targetId === elementId),
      outgoing: relationships.filter(r => r.sourceId === elementId),
    };
  }

  /**
   * Query relationships with filters
   */
  async queryRelationships(filter: UAFRelationshipFilter): Promise<UAFRelationship[]> {
    let relationships = this.getLocalRelationships(filter.workspaceId || '');

    if (filter.sourceId) {
      relationships = relationships.filter(r => r.sourceId === filter.sourceId);
    }
    if (filter.targetId) {
      relationships = relationships.filter(r => r.targetId === filter.targetId);
    }
    if (filter.relationshipType) {
      relationships = relationships.filter(r => r.relationshipType === filter.relationshipType);
    }

    const offset = filter.offset || 0;
    const limit = filter.limit || 100;
    return relationships.slice(offset, offset + limit);
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(workspaceId: string, relationshipId: string): Promise<boolean> {
    const relationships = this.getLocalRelationships(workspaceId);
    const filtered = relationships.filter(r => r.id !== relationshipId);
    this.setLocalRelationships(workspaceId, filtered);
    return true;
  }

  // ============ GRID OPERATIONS ============

  /**
   * Get the UAF grid for a workspace - shows element counts per cell
   */
  async getGrid(workspaceId: string): Promise<UAFGridCell[][]> {
    const elements = await this.queryElements({ workspaceId });

    const grid: UAFGridCell[][] = [];
    const viewpoints = Object.keys(UAF_VIEWPOINTS) as UAFViewpoint[];
    const modelKinds = Object.keys(UAF_MODEL_KINDS) as UAFModelKind[];

    for (const viewpoint of viewpoints) {
      const row: UAFGridCell[] = [];
      for (const modelKind of modelKinds) {
        const cellElements = elements.filter(
          e => e.viewpoint === viewpoint && e.modelKind === modelKind
        );
        row.push({
          viewpoint,
          modelKind,
          viewCode: `${UAF_VIEWPOINTS[viewpoint].code}-${UAF_MODEL_KINDS[modelKind].code}`,
          viewName: `${UAF_VIEWPOINTS[viewpoint].name} ${UAF_MODEL_KINDS[modelKind].name}`,
          elementCount: cellElements.length,
          elements: cellElements,
        });
      }
      grid.push(row);
    }

    return grid;
  }

  /**
   * Get summary statistics for a workspace's architecture
   */
  async getStats(workspaceId: string): Promise<{
    totalElements: number;
    totalRelationships: number;
    byViewpoint: Record<UAFViewpoint, number>;
    byModelKind: Record<UAFModelKind, number>;
    byElementType: Record<string, number>;
  }> {
    const elements = await this.queryElements({ workspaceId });
    const relationships = await this.queryRelationships({ workspaceId });

    const byViewpoint: Record<string, number> = {};
    const byModelKind: Record<string, number> = {};
    const byElementType: Record<string, number> = {};

    for (const element of elements) {
      byViewpoint[element.viewpoint] = (byViewpoint[element.viewpoint] || 0) + 1;
      byModelKind[element.modelKind] = (byModelKind[element.modelKind] || 0) + 1;
      byElementType[element.elementType] = (byElementType[element.elementType] || 0) + 1;
    }

    return {
      totalElements: elements.length,
      totalRelationships: relationships.length,
      byViewpoint: byViewpoint as Record<UAFViewpoint, number>,
      byModelKind: byModelKind as Record<UAFModelKind, number>,
      byElementType,
    };
  }

  // ============ ARCHITECTURE OPERATIONS ============

  /**
   * Get complete architecture for a workspace
   */
  async getArchitecture(workspaceId: string): Promise<UAFArchitecture> {
    const elements = await this.queryElements({ workspaceId });
    const relationships = await this.queryRelationships({ workspaceId });

    return {
      workspaceId,
      name: 'Workspace Architecture',
      description: 'UAF Architecture for workspace',
      version: '1.0',
      elements,
      relationships,
      views: [], // Views are generated on demand
      metadata: {
        createdBy: 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    };
  }

  /**
   * Export architecture to JSON
   */
  async exportArchitecture(workspaceId: string): Promise<string> {
    const architecture = await this.getArchitecture(workspaceId);
    return JSON.stringify(architecture, null, 2);
  }

  /**
   * Import architecture from JSON
   */
  async importArchitecture(
    workspaceId: string,
    json: string,
    userId: string
  ): Promise<{ elementsImported: number; relationshipsImported: number }> {
    const architecture = JSON.parse(json) as UAFArchitecture;
    let elementsImported = 0;
    let relationshipsImported = 0;

    for (const element of architecture.elements) {
      await this.createElement(
        workspaceId,
        {
          name: element.name,
          description: element.description,
          viewpoint: element.viewpoint,
          modelKind: element.modelKind,
          elementType: element.elementType,
          properties: element.properties,
        },
        userId
      );
      elementsImported++;
    }

    for (const rel of architecture.relationships) {
      await this.createRelationship(
        workspaceId,
        {
          sourceId: rel.sourceId,
          targetId: rel.targetId,
          relationshipType: rel.relationshipType,
          name: rel.name,
          description: rel.description,
          properties: rel.properties,
        },
        userId
      );
      relationshipsImported++;
    }

    return { elementsImported, relationshipsImported };
  }

  // ============ LOCAL STORAGE (fallback when Appwrite unavailable) ============

  private localElements: Map<string, UAFElement[]> = new Map();
  private localRelationships: Map<string, UAFRelationship[]> = new Map();

  private getLocalElements(workspaceId: string): UAFElement[] {
    return this.localElements.get(workspaceId) || [];
  }

  private setLocalElements(workspaceId: string, elements: UAFElement[]): void {
    this.localElements.set(workspaceId, elements);
  }

  private storeElementLocally(element: UAFElement): void {
    const elements = this.getLocalElements(element.workspaceId);
    const index = elements.findIndex(e => e.id === element.id);
    if (index >= 0) {
      elements[index] = element;
    } else {
      elements.push(element);
    }
    this.setLocalElements(element.workspaceId, elements);
  }

  private getLocalElement(workspaceId: string, elementId: string): UAFElement | null {
    const elements = this.getLocalElements(workspaceId);
    return elements.find(e => e.id === elementId) || null;
  }

  private getLocalRelationships(workspaceId: string): UAFRelationship[] {
    return this.localRelationships.get(workspaceId) || [];
  }

  private setLocalRelationships(workspaceId: string, relationships: UAFRelationship[]): void {
    this.localRelationships.set(workspaceId, relationships);
  }

  private storeRelationshipLocally(relationship: UAFRelationship): void {
    const relationships = this.getLocalRelationships(relationship.workspaceId);
    const index = relationships.findIndex(r => r.id === relationship.id);
    if (index >= 0) {
      relationships[index] = relationship;
    } else {
      relationships.push(relationship);
    }
    this.setLocalRelationships(relationship.workspaceId, relationships);
  }

  private documentToElement(doc: any): UAFElement {
    return {
      id: doc.$id,
      workspaceId: doc.workspaceId,
      name: doc.name,
      description: doc.description,
      viewpoint: doc.viewpoint,
      modelKind: doc.modelKind,
      elementType: doc.elementType,
      properties: doc.properties || {},
      metadata: {
        createdBy: doc.createdBy,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        version: doc.version || 1,
      },
    };
  }
}

export const uafService = new UAFService();
