export interface GraphNode {
  id: string;
  type: string;
  label: string;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  type: 'depends_on' | 'caused_by' | 'implements';
}

export interface IKnowledgeGraph {
  addNode(node: GraphNode): void;
  addEdge(edge: GraphEdge): void;
  getRelatedNodes(nodeId: string): GraphNode[];
}
