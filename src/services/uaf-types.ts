/**
 * UAF (Unified Architecture Framework) Types
 *
 * OMG/ISO Standard (ISO/IEC 19540) for Model-Based Systems Engineering
 * Implements the UAF Grid: 11 Viewpoints x 14 Model Kinds = 71 View Specifications
 */

// ============ VIEWPOINTS (Rows in UAF Grid) ============

export type UAFViewpoint =
  | 'metadata'          // Md - Architecture management
  | 'summary'           // Sm - High-level overview
  | 'strategic'         // St - Vision, goals, capabilities (WHY)
  | 'operational'       // Op - Activities, performers, info exchange (WHAT)
  | 'services'          // Sv - Service definitions and interfaces
  | 'personnel'         // Pr - Roles, skills, organizations (WHO)
  | 'resources'         // Rs - Systems, software, hardware (HOW)
  | 'security'          // Sc - Security constraints
  | 'projects'          // Pj - Implementation timelines (WHEN)
  | 'standards'         // Sd - Technical standards and protocols
  | 'actual_resources'; // Ar - Deployed instances

export const UAF_VIEWPOINTS: Record<UAFViewpoint, { code: string; name: string; description: string }> = {
  metadata: { code: 'Md', name: 'Metadata', description: 'Architecture management and governance' },
  summary: { code: 'Sm', name: 'Summary & Overview', description: 'High-level architecture views' },
  strategic: { code: 'St', name: 'Strategic', description: 'Vision, goals, and capabilities (WHY)' },
  operational: { code: 'Op', name: 'Operational', description: 'Activities, performers, information exchange (WHAT)' },
  services: { code: 'Sv', name: 'Services', description: 'Service definitions and interfaces' },
  personnel: { code: 'Pr', name: 'Personnel', description: 'Roles, skills, organizations (WHO)' },
  resources: { code: 'Rs', name: 'Resources', description: 'Systems, software, hardware (HOW)' },
  security: { code: 'Sc', name: 'Security', description: 'Security constraints across viewpoints' },
  projects: { code: 'Pj', name: 'Projects', description: 'Implementation timelines (WHEN)' },
  standards: { code: 'Sd', name: 'Standards', description: 'Technical standards and protocols' },
  actual_resources: { code: 'Ar', name: 'Actual Resources', description: 'Deployed instances and configurations' },
};

// ============ MODEL KINDS (Columns in UAF Grid) ============

export type UAFModelKind =
  | 'taxonomy'      // Tx - Classification hierarchies
  | 'structure'     // Sr - Composition and relationships
  | 'connectivity'  // Cn - Connections and interfaces
  | 'processes'     // Pr - Behavior and workflows
  | 'states'        // St - State machines
  | 'scenarios'     // Is - Interaction sequences
  | 'information'   // If - Data models
  | 'parameters'    // Pm - Measurements and KPIs
  | 'constraints'   // Ct - Rules and policies
  | 'traceability'  // Tr - Cross-viewpoint mappings
  | 'roadmap'       // Rm - Evolution over time
  | 'dictionary'    // Dc - Terms and definitions
  | 'requirements'; // Req - Requirements allocation

export const UAF_MODEL_KINDS: Record<UAFModelKind, { code: string; name: string; description: string }> = {
  taxonomy: { code: 'Tx', name: 'Taxonomy', description: 'Classification and type hierarchies' },
  structure: { code: 'Sr', name: 'Structure', description: 'Composition and structural relationships' },
  connectivity: { code: 'Cn', name: 'Connectivity', description: 'Connections, ports, and interfaces' },
  processes: { code: 'Pr', name: 'Processes', description: 'Behavioral flows and activities' },
  states: { code: 'St', name: 'States', description: 'State machines and transitions' },
  scenarios: { code: 'Is', name: 'Interaction Scenarios', description: 'Sequence diagrams and use cases' },
  information: { code: 'If', name: 'Information', description: 'Data models and information flows' },
  parameters: { code: 'Pm', name: 'Parameters', description: 'Measurements, KPIs, and properties' },
  constraints: { code: 'Ct', name: 'Constraints', description: 'Rules, policies, and conditions' },
  traceability: { code: 'Tr', name: 'Traceability', description: 'Cross-viewpoint mappings and dependencies' },
  roadmap: { code: 'Rm', name: 'Roadmap', description: 'Timeline and evolution planning' },
  dictionary: { code: 'Dc', name: 'Dictionary', description: 'Terms, definitions, and glossary' },
  requirements: { code: 'Req', name: 'Requirements', description: 'Requirements allocation and tracing' },
};

// ============ ELEMENT TYPES ============

export type UAFElementType =
  // Strategic
  | 'capability'
  | 'vision'
  | 'goal'
  | 'objective'
  | 'enterprise_phase'
  // Operational
  | 'operational_performer'
  | 'operational_activity'
  | 'operational_exchange'
  | 'information_element'
  | 'rule'
  // Services
  | 'service'
  | 'service_interface'
  | 'service_function'
  // Personnel
  | 'person_type'
  | 'organization'
  | 'role'
  | 'skill'
  | 'competence'
  // Resources
  | 'system'
  | 'software'
  | 'hardware'
  | 'technology'
  | 'resource_function'
  | 'resource_interface'
  // Security
  | 'security_control'
  | 'threat'
  | 'vulnerability'
  | 'risk'
  // Projects
  | 'project'
  | 'milestone'
  | 'increment'
  // Standards
  | 'standard'
  | 'protocol'
  | 'guidance'
  // Actual Resources
  | 'actual_organization'
  | 'actual_person'
  | 'actual_system'
  | 'actual_software'
  // Generic
  | 'custom';

// ============ RELATIONSHIP TYPES ============

export type UAFRelationshipType =
  // Structural
  | 'composes'           // Parent-child composition
  | 'specializes'        // Inheritance/generalization
  | 'associates'         // General association
  // Behavioral
  | 'triggers'           // Event triggering
  | 'precedes'           // Temporal ordering
  | 'enables'            // Enablement dependency
  // Traceability
  | 'realizes'           // Realization mapping
  | 'satisfies'          // Requirement satisfaction
  | 'traces_to'          // General traceability
  | 'allocates'          // Resource allocation
  // Operational
  | 'performs'           // Performer executes activity
  | 'exchanges'          // Information exchange
  | 'consumes'           // Resource consumption
  | 'produces'           // Output production
  // Services
  | 'provides'           // Service provision
  | 'requires'           // Service dependency
  | 'implements'         // Implementation relationship
  // Security
  | 'mitigates'          // Risk mitigation
  | 'exposes'            // Vulnerability exposure
  | 'protects'           // Security protection
  // Custom
  | 'custom';

// ============ CORE INTERFACES ============

/**
 * Base metadata for all UAF entities
 */
export interface UAFMetadata {
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  tags?: string[];
  externalIds?: Record<string, string>; // For XMI/external tool IDs
}

/**
 * Base UAF Element - foundation for all architecture elements
 */
export interface UAFElement {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  viewpoint: UAFViewpoint;
  modelKind: UAFModelKind;
  elementType: UAFElementType;
  properties: Record<string, any>;
  metadata: UAFMetadata;
}

/**
 * UAF Relationship - connections between elements
 */
export interface UAFRelationship {
  id: string;
  workspaceId: string;
  sourceId: string;
  targetId: string;
  relationshipType: UAFRelationshipType;
  name?: string;
  description?: string;
  properties?: Record<string, any>;
  metadata: UAFMetadata;
}

// ============ SPECIALIZED ELEMENT INTERFACES ============

/**
 * Strategic Capability
 */
export interface UAFCapability extends UAFElement {
  elementType: 'capability';
  properties: {
    level?: number;           // Capability maturity level
    priority?: 'high' | 'medium' | 'low';
    timeframe?: string;       // Target timeframe
    metrics?: string[];       // Success metrics
    parentCapabilityId?: string;
  };
}

/**
 * Operational Activity
 */
export interface UAFOperationalActivity extends UAFElement {
  elementType: 'operational_activity';
  properties: {
    inputs?: string[];
    outputs?: string[];
    performerId?: string;
    duration?: string;
    preconditions?: string[];
    postconditions?: string[];
  };
}

/**
 * Operational Performer
 */
export interface UAFOperationalPerformer extends UAFElement {
  elementType: 'operational_performer';
  properties: {
    performerType?: 'human' | 'system' | 'organization' | 'hybrid';
    responsibilities?: string[];
    capabilities?: string[];
  };
}

/**
 * Resource (System/Software/Hardware)
 */
export interface UAFResource extends UAFElement {
  elementType: 'system' | 'software' | 'hardware' | 'technology';
  properties: {
    vendor?: string;
    version?: string;
    status?: 'planned' | 'in_development' | 'operational' | 'retired';
    interfaces?: string[];
    deploymentLocation?: string;
  };
}

/**
 * Service Definition
 */
export interface UAFService extends UAFElement {
  elementType: 'service';
  properties: {
    serviceType?: 'business' | 'application' | 'infrastructure';
    endpoint?: string;
    protocol?: string;
    sla?: Record<string, any>;
    operations?: string[];
  };
}

/**
 * Security Control
 */
export interface UAFSecurityControl extends UAFElement {
  elementType: 'security_control';
  properties: {
    controlType?: 'preventive' | 'detective' | 'corrective';
    framework?: string;       // NIST, ISO27001, etc.
    controlId?: string;       // Framework control ID
    implementationStatus?: 'planned' | 'partial' | 'implemented';
  };
}

/**
 * Project/Milestone
 */
export interface UAFProject extends UAFElement {
  elementType: 'project' | 'milestone' | 'increment';
  properties: {
    startDate?: string;
    endDate?: string;
    status?: 'planned' | 'active' | 'completed' | 'cancelled';
    budget?: number;
    dependencies?: string[];
  };
}

/**
 * Standard/Protocol
 */
export interface UAFStandard extends UAFElement {
  elementType: 'standard' | 'protocol' | 'guidance';
  properties: {
    standardBody?: string;    // ISO, OMG, IEEE, etc.
    version?: string;
    url?: string;
    mandatory?: boolean;
  };
}

// ============ VIEW INTERFACES ============

/**
 * UAF View - generated diagram/visualization
 */
export interface UAFView {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  viewpoint: UAFViewpoint;
  modelKind: UAFModelKind;
  viewType: string;           // e.g., 'capability_taxonomy', 'operational_connectivity'
  elementIds: string[];       // Elements included in this view
  relationshipIds: string[];  // Relationships shown
  layout?: Record<string, any>; // Position data for elements
  diagram?: string;           // Generated diagram (Mermaid, SVG, etc.)
  metadata: UAFMetadata;
}

/**
 * UAF Grid Cell - represents one cell in the 11x14 grid
 */
export interface UAFGridCell {
  viewpoint: UAFViewpoint;
  modelKind: UAFModelKind;
  viewCode: string;           // e.g., 'St-Tx' for Strategic Taxonomy
  viewName: string;           // e.g., 'Capability Taxonomy'
  elementCount: number;
  elements: UAFElement[];
}

/**
 * UAF Architecture - complete architecture for a workspace
 */
export interface UAFArchitecture {
  workspaceId: string;
  name: string;
  description: string;
  version: string;
  elements: UAFElement[];
  relationships: UAFRelationship[];
  views: UAFView[];
  metadata: UAFMetadata;
}

// ============ QUERY/FILTER INTERFACES ============

export interface UAFElementFilter {
  workspaceId?: string;
  viewpoint?: UAFViewpoint;
  modelKind?: UAFModelKind;
  elementType?: UAFElementType;
  search?: string;            // Text search in name/description
  tags?: string[];
  createdBy?: string;
  limit?: number;
  offset?: number;
}

export interface UAFRelationshipFilter {
  workspaceId?: string;
  sourceId?: string;
  targetId?: string;
  relationshipType?: UAFRelationshipType;
  limit?: number;
  offset?: number;
}

// ============ AI ANALYSIS INTERFACES ============

export interface UAFAnalysisRequest {
  workspaceId: string;
  analysisType:
    | 'completeness'      // Check for missing elements
    | 'consistency'       // Check for conflicts
    | 'traceability'      // Verify cross-viewpoint links
    | 'gaps'              // Identify architecture gaps
    | 'suggestions'       // AI recommendations
    | 'natural_language'; // Parse NL into elements
  scope?: {
    viewpoints?: UAFViewpoint[];
    modelKinds?: UAFModelKind[];
    elementIds?: string[];
  };
  prompt?: string;          // For natural_language analysis
}

export interface UAFAnalysisResult {
  analysisType: string;
  findings: Array<{
    severity: 'info' | 'warning' | 'error';
    category: string;
    message: string;
    affectedElements?: string[];
    suggestion?: string;
  }>;
  suggestions?: Array<{
    action: 'create' | 'update' | 'delete' | 'link';
    elementType?: UAFElementType;
    viewpoint?: UAFViewpoint;
    details: Record<string, any>;
  }>;
  summary: string;
}

// ============ EXPORT/IMPORT INTERFACES ============

export interface UAFExportOptions {
  format: 'json' | 'xmi' | 'csv';
  includeViews?: boolean;
  includeRelationships?: boolean;
  viewpoints?: UAFViewpoint[];
  modelKinds?: UAFModelKind[];
}

export interface UAFImportResult {
  success: boolean;
  elementsImported: number;
  relationshipsImported: number;
  errors: string[];
  warnings: string[];
}
