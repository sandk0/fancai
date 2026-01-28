"""
Graph Service.

Responsible for:
1. Loading Graph from DB (EntityRelationship)
2. Network Analysis (PageRank, Community Detection) using NetworkX
3. Exporting Graph for Visualization
"""

import logging
import networkx as nx
from typing import List, Dict, Any, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, case
from app.models.entity import Entity
from app.models.entity_relationship import EntityRelationship
from app.models.book import Book

logger = logging.getLogger(__name__)

class GraphService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self._graph = None

    async def build_graph(self, book_id: str) -> nx.Graph:
        """
        Load entities and edges from DB into NetworkX graph.
        """
        G = nx.Graph()
        
        # 1. Nodes
        q_nodes = select(Entity).where(Entity.book_id == book_id)
        nodes_res = await self.db.execute(q_nodes)
        entities = nodes_res.scalars().all()
        
        for e in entities:
            G.add_node(str(e.id), label=e.name, type=e.type, importance=e.importance or 5)
            
        # 2. Edges
        # Get all relationship for these entities
        entity_ids = [e.id for e in entities]
        if not entity_ids:
            return G
            
        q_edges = select(EntityRelationship).where(
            EntityRelationship.source_id.in_(entity_ids)
        ) # Sufficient if graph is closed within book
        
        edges_res = await self.db.execute(q_edges)
        edges = edges_res.scalars().all()
        
        for edge in edges:
            G.add_edge(
                str(edge.source_id), 
                str(edge.target_id), 
                weight=abs(edge.weight), # PageRank needs positive weights
                type=edge.type,
                raw_weight=edge.weight
            )
            
        self._graph = G
        return G

    async def calculate_pagerank(self, book_id: str) -> bool:
        """
        Calculate PageRank and update Entity.importance in DB.
        """
        G = await self.build_graph(book_id)
        if len(G.nodes) == 0:
            return False
            
        try:
            # Algorithms
            # 1. PageRank for Importance
            pagerank = nx.pagerank(G, weight='weight')
            
            # 2. Normalize to 1-10 scale
            # Max pagerank usually small (0.something). 
            # We map: Max -> 10, Min -> 1.
            if not pagerank: return False
                
            max_pr = max(pagerank.values())
            min_pr = min(pagerank.values())
            
            updates = []
            for node_id, pr_val in pagerank.items():
                if max_pr == min_pr:
                    score = 5
                else:
                    score = 1 + int(9 * (pr_val - min_pr) / (max_pr - min_pr))
                
                # Update logic
                # update(Entity).where(Entity.id == node_id).values(importance=score)
                # Batch update is better?
                # For now single updates is fine for < 500 entities
                updates.append((node_id, score))
                
            if updates:
                case_conditions = []
                uuid_ids = []
                for node_id, score in updates:
                    uuid_id = UUID(node_id)
                    uuid_ids.append(uuid_id)
                    case_conditions.append((Entity.id == uuid_id, score))
                
                stmt = (
                    update(Entity)
                    .where(Entity.id.in_(uuid_ids))
                    .values(importance=case(*case_conditions, else_=Entity.importance))
                )
                await self.db.execute(stmt)
                
            await self.db.commit()
            logger.info(f"PageRank calculated for book {book_id}. Updated {len(updates)} entities.")
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Graph Analysis failed: {e}")
            return False

    async def get_visualization_data(self, book_id: str) -> Dict[str, Any]:
        """
        Return JSON for React Force Graph.
        """
        G = await self.build_graph(book_id)
        
        # Calculate communities for coloring
        try:
            import community as community_louvain
            partition = community_louvain.best_partition(G)
        except ImportError:
            partition = {} # Fallback
            
        nodes = []
        for n, attrs in G.nodes(data=True):
            nodes.append({
                "id": n,
                "name": attrs.get('label'),
                "val": attrs.get('importance', 5),
                "group": partition.get(n, 1)
            })
            
        links = []
        for u, v, attrs in G.edges(data=True):
            links.append({
                "source": u,
                "target": v,
                "value": attrs.get('raw_weight', 1)
            })
            
        return {"nodes": nodes, "links": links}

# Factory
def get_graph_service(db: AsyncSession) -> GraphService:
    return GraphService(db)
