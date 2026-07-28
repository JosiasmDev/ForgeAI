import { IKnowledgeGraph, GraphNode, GraphEdge } from './types';

export class KnowledgeGraph implements IKnowledgeGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  public addEdge(edge: GraphEdge): void {
    this.edges.push(edge);
  }

  public getRelatedNodes(nodeId: string): GraphNode[] {
    const relatedIds = this.edges
      .filter((e) => e.fromId === nodeId || e.toId === nodeId)
      .map((e) => (e.fromId === nodeId ? e.toId : e.fromId));

    return relatedIds.map((id) => this.nodes.get(id)!).filter(Boolean);
  }
}
