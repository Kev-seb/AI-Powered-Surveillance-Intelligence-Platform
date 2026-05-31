"""
Face Recognition Module
Combines DeepFace FaceNet512 embeddings with FAISS vector search.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class FaceRecognizer:
    """
    DeepFace FaceNet512 + FAISS cosine similarity search.
    Loads registered face embeddings from MongoDB and builds a FAISS index.
    """

    def __init__(self, similarity_threshold: float = 0.65):
        self.threshold = similarity_threshold
        self._index = None
        self._person_ids: List[str] = []
        self._is_built = False
        logger.info("FaceRecognizer initialized")

    async def build_index(self, mongo_db) -> int:
        """Build FAISS index from registered face embeddings in MongoDB."""
        import faiss

        docs = await mongo_db.face_embeddings.find({}).to_list(length=10000)
        if not docs:
            logger.warning("No face embeddings found in registry")
            self._is_built = False
            return 0

        embeddings = []
        self._person_ids = []

        for doc in docs:
            emb = doc.get("embedding", [])
            if emb and len(emb) == 512:  # FaceNet512 dimension
                embeddings.append(np.array(emb, dtype=np.float32))
                self._person_ids.append(doc["person_id"])

        if not embeddings:
            return 0

        # Build FAISS index with L2 normalization for cosine similarity
        dim = 512
        matrix = np.vstack(embeddings)
        faiss.normalize_L2(matrix)

        self._index = faiss.IndexFlatIP(dim)  # Inner product = cosine after normalization
        self._index.add(matrix)
        self._is_built = True

        logger.info(f"FAISS index built: {len(embeddings)} faces")
        return len(embeddings)

    def build_index_sync(self, mongo_db) -> int:
        """Build FAISS index from registered face embeddings in MongoDB synchronously."""
        import faiss

        docs = list(mongo_db.face_embeddings.find({}))
        if not docs:
            logger.warning("No face embeddings found in registry")
            self._is_built = False
            return 0

        embeddings = []
        self._person_ids = []

        for doc in docs:
            emb = doc.get("embedding", [])
            if emb and len(emb) == 512:  # FaceNet512 dimension
                embeddings.append(np.array(emb, dtype=np.float32))
                self._person_ids.append(str(doc["person_id"]))

        if not embeddings:
            return 0

        # Build FAISS index with L2 normalization for cosine similarity
        dim = 512
        matrix = np.vstack(embeddings)
        faiss.normalize_L2(matrix)

        self._index = faiss.IndexFlatIP(dim)  # Inner product = cosine after normalization
        self._index.add(matrix)
        self._is_built = True

        logger.info(f"FAISS index built synchronously: {len(embeddings)} faces")
        return len(embeddings)

    def recognize_face(self, face_image: np.ndarray) -> Dict:
        """
        Recognize a face in a cropped image.
        Returns: {"person_id": str | None, "confidence": float, "matched": bool}
        """
        if not self._is_built or self._index is None:
            return {"person_id": None, "confidence": 0.0, "matched": False}

        try:
            embedding = self._extract_embedding(face_image)
            if embedding is None:
                return {"person_id": None, "confidence": 0.0, "matched": False}

            return self._search(embedding)
        except Exception as e:
            logger.debug(f"Face recognition error: {e}")
            return {"person_id": None, "confidence": 0.0, "matched": False}

    def _extract_embedding(self, image: np.ndarray) -> Optional[np.ndarray]:
        """Extract FaceNet512 embedding from a face image."""
        import faiss
        from deepface import DeepFace

        try:
            results = DeepFace.represent(
                img_path=image,
                model_name="Facenet512",
                enforce_detection=False,
                detector_backend="opencv",
            )
            if results:
                results.sort(key=lambda x: x["facial_area"]["w"] * x["facial_area"]["h"], reverse=True)
                emb = np.array(results[0]["embedding"], dtype=np.float32)
                emb = emb.reshape(1, -1)
                faiss.normalize_L2(emb)
                return emb
        except Exception as e:
            logger.debug(f"Embedding extraction failed: {e}")
        return None

    def _search(self, embedding: np.ndarray) -> Dict:
        """Search FAISS index for closest match."""
        distances, indices = self._index.search(embedding, k=1)
        similarity = float(distances[0][0])
        idx = int(indices[0][0])

        if similarity >= self.threshold and 0 <= idx < len(self._person_ids):
            return {
                "person_id": self._person_ids[idx],
                "confidence": similarity,
                "matched": True,
            }
        return {"person_id": None, "confidence": similarity, "matched": False}

    def extract_face_crop(
        self, frame: np.ndarray, bbox: dict
    ) -> Optional[np.ndarray]:
        """Crop face region from frame with margin."""
        x, y, w, h = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
        margin = int(min(w, h) * 0.1)

        fh, fw = frame.shape[:2]
        x1 = max(0, x - margin)
        y1 = max(0, y - margin)
        x2 = min(fw, x + w + margin)
        y2 = min(fh, y + h + margin)

        if x2 <= x1 or y2 <= y1:
            return None

        return frame[y1:y2, x1:x2]
