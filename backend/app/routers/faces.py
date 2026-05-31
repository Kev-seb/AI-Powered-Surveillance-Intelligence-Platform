"""Face registration router."""
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, get_mongo_db
from app.core.security import require_role
from app.models.person import Person

router = APIRouter()

PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


@router.post("/register")
async def register_face(
    person_id: uuid.UUID = Form(...),
    photo: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    mongo=Depends(get_mongo_db),
    _=Depends(require_role("analyst")),
):
    """Register a face photo and compute+store embedding for a person."""
    # Validate file
    ext = Path(photo.filename).suffix.lower()
    if ext not in PHOTO_EXTENSIONS:
        raise HTTPException(400, f"Unsupported photo format: {ext}")

    # Fetch person
    result = await db.execute(select(Person).where(Person.id == person_id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(404, "Person not found")

    # Save photo
    content = await photo.read()
    photo_filename = f"{person_id}_face{ext}"
    photo_path = Path(settings.UPLOAD_DIR) / "faces" / photo_filename
    photo_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(photo_path, "wb") as f:
        await f.write(content)

    # Generate embedding (run in executor to avoid blocking)
    import asyncio
    import numpy as np

    def compute_embedding(path: str) -> list:
        from deepface import DeepFace
        result = DeepFace.represent(
            img_path=path,
            model_name="Facenet512",
            enforce_detection=False,
        )
        if result:
            result.sort(key=lambda x: x["facial_area"]["w"] * x["facial_area"]["h"], reverse=True)
            return result[0]["embedding"]
        return []


    loop = asyncio.get_event_loop()
    try:
        embedding = await loop.run_in_executor(None, compute_embedding, str(photo_path))
    except Exception as e:
        raise HTTPException(500, f"Face embedding failed: {str(e)}")

    if not embedding:
        raise HTTPException(422, "No face detected in the photo")

    # Store embedding in MongoDB
    embedding_doc = {
        "person_id": str(person_id),
        "embedding": embedding,
        "photo_path": str(photo_path),
        "model": "Facenet512",
        "created_at": __import__("datetime").datetime.utcnow(),
    }
    await mongo.face_embeddings.replace_one(
        {"person_id": str(person_id)},
        embedding_doc,
        upsert=True,
    )

    # Update person record
    person.photo_path = str(photo_path)
    person.face_embedding_id = str(person_id)
    person.is_registered = True
    import datetime
    person.registered_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()

    return {
        "message": "Face registered successfully",
        "person_id": str(person_id),
        "embedding_length": len(embedding),
    }


@router.post("/search")
async def search_face(
    photo: UploadFile = File(...),
    threshold: float = 0.6,
    db: AsyncSession = Depends(get_db),
    mongo=Depends(get_mongo_db),
    _=Depends(require_role("operator")),
):
    """Search face registry for a matching person."""
    import asyncio
    import numpy as np
    from pathlib import Path

    content = await photo.read()
    ext = Path(photo.filename or "face.jpg").suffix.lower() or ".jpg"
    tmp_path = Path(settings.UPLOAD_DIR) / "faces" / f"search_tmp_{uuid.uuid4()}{ext}"
    tmp_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(tmp_path, "wb") as f:
        await f.write(content)

    def compute_embedding(path: str):
        from deepface import DeepFace
        result = DeepFace.represent(img_path=path, model_name="Facenet512", enforce_detection=False)
        if result:
            result.sort(key=lambda x: x["facial_area"]["w"] * x["facial_area"]["h"], reverse=True)
            return result[0]["embedding"]
        return []


    loop = asyncio.get_event_loop()
    try:
        query_embedding = await loop.run_in_executor(None, compute_embedding, str(tmp_path))
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Face embedding failed: {str(e)}")
    finally:
        tmp_path.unlink(missing_ok=True)

    if not query_embedding:
        return {"matches": [], "message": "No face detected in query image"}

    q_vec = np.array(query_embedding)
    matches = []
    async for doc in mongo.face_embeddings.find({}):
        stored = np.array(doc["embedding"])
        norm = np.linalg.norm(q_vec) * np.linalg.norm(stored)
        similarity = float(np.dot(q_vec, stored) / norm) if norm > 0 else 0.0
        if similarity >= threshold:
            person_id = doc["person_id"]
            result = await db.execute(select(Person).where(Person.id == uuid.UUID(person_id)))
            person = result.scalar_one_or_none()
            matches.append({
                "person_id": person_id,
                "person_name": person.name if person else None,
                "confidence": similarity,
            })

    matches.sort(key=lambda x: x["confidence"], reverse=True)
    return {"matches": matches[:5]}


@router.get("/")
async def list_registered_faces(
    db: AsyncSession = Depends(get_db),
    mongo=Depends(get_mongo_db),
    _=Depends(require_role("operator")),
):
    """List all persons with registered face embeddings."""
    registered_ids = set()
    async for doc in mongo.face_embeddings.find({}, {"person_id": 1}):
        registered_ids.add(doc["person_id"])

    if not registered_ids:
        return []

    from sqlalchemy import or_
    result = await db.execute(
        select(Person).where(Person.is_registered == True)
    )
    persons = result.scalars().all()
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "risk_level": p.risk_level,
            "registered_at": p.registered_at.isoformat() if p.registered_at else None,
        }
        for p in persons
    ]


@router.delete("/{person_id}")
async def delete_registered_face(
    person_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    mongo=Depends(get_mongo_db),
    _=Depends(require_role("analyst")),
):
    """Delete registered face embedding and associated photo for a person."""
    # Find person
    result = await db.execute(select(Person).where(Person.id == person_id))
    person = result.scalar_one_or_none()
    if not person:
        raise HTTPException(404, "Person not found")

    # Delete embedding from MongoDB
    await mongo.face_embeddings.delete_one({"person_id": str(person_id)})

    # Delete photo file from disk if exists
    if person.photo_path:
        photo_path = Path(person.photo_path)
        if photo_path.exists():
            photo_path.unlink()

    # Reset person fields in SQL
    person.photo_path = None
    person.face_embedding_id = None
    person.is_registered = False
    person.registered_at = None
    await db.flush()

    return {
        "message": "Face registry entry deleted successfully",
        "person_id": str(person_id),
    }


