// MongoDB Initialization — AI Surveillance Platform
db = db.getSiblingDB('surveillance');

// ── Face Embeddings Collection ─────────────────────────────────────
db.createCollection('face_embeddings');
db.face_embeddings.createIndex({ person_id: 1 });
db.face_embeddings.createIndex({ created_at: -1 });
db.face_embeddings.createIndex(
    { person_id: 1 },
    { unique: true, sparse: true, name: 'unique_person_embedding' }
);

// ── Video Frame Evidence ───────────────────────────────────────────
db.createCollection('frame_evidence');
db.frame_evidence.createIndex({ event_id: 1 });
db.frame_evidence.createIndex({ video_id: 1, frame_number: 1 });
db.frame_evidence.createIndex({ created_at: -1 });
db.frame_evidence.createIndex(
    { created_at: 1 },
    { expireAfterSeconds: 7776000, name: 'ttl_90_days' } // 90 days TTL
);

// ── Trajectory Data ────────────────────────────────────────────────
db.createCollection('trajectories');
db.trajectories.createIndex({ video_id: 1, track_id: 1 });
db.trajectories.createIndex({ created_at: -1 });
db.trajectories.createIndex(
    { created_at: 1 },
    { expireAfterSeconds: 2592000, name: 'ttl_30_days' } // 30 days TTL
);

// ── LLM Incident Narratives ────────────────────────────────────────
db.createCollection('incident_narratives');
db.incident_narratives.createIndex({ report_id: 1 });
db.incident_narratives.createIndex({ video_id: 1 });
db.incident_narratives.createIndex({ generated_at: -1 });

// ── Heatmap Aggregations ───────────────────────────────────────────
db.createCollection('heatmaps');
db.heatmaps.createIndex({ video_id: 1 });
db.heatmaps.createIndex({ camera_id: 1, date: -1 });

// ── Intelligence Briefings (daily AI summaries) ────────────────────
db.createCollection('intelligence_briefings');
db.intelligence_briefings.createIndex({ date: -1 }, { unique: true });

print('MongoDB surveillance database initialized successfully.');
