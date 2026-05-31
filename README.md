---
title: Asip Backend
emoji: 🛡️
colorFrom: pink
colorTo: green
sdk: docker
pinned: false
license: mit
app_port: 7860
---

# 🛡️ ASIP — AI-Powered Surveillance Intelligence Platform

> **ASIP** is an enterprise-grade AI-powered surveillance operations platform designed to orchestrate video stream analysis, detect security anomalies, track objects in real time, and generate natural language briefings using cloud and local LLMs. It is built as a highly optimized monorepo that scales from local Docker Compose containers to serverless cloud environments.

---

## 🏗️ Architecture Overview

The platform is designed around a decoupled, event-driven architecture that splits tasks between a real-time web server (FastAPI), a high-throughput background worker pool (Celery), and a reactive frontend (React).

### Local Orchestration (Docker Compose)
* **Frontend:** React 18 SPA served via Nginx.
* **Backend:** FastAPI Web API serving REST endpoints and managing active WebSocket alert streams.
* **Worker Pool:** Celery workers consuming tasks from Redis queues with CPU/GPU access.
* **Databases:** PostgreSQL (with TimescaleDB extension for time-series events), MongoDB (document store for zones, identities, and audit trails), and Redis (broker + WebSocket session management).

### Cloud Orchestration (Serverless)
* **Frontend:** Deployed on **Vercel** with client-side SPA route rewrites configured in [vercel.json](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/frontend/vercel.json).
* **Backend + Workers:** Hosted inside a single-container orchestration run on **Hugging Face Spaces**. Both Uvicorn (FastAPI) and Celery boot concurrently via [start.sh](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/backend/start.sh).
* **Cloud Databases:** Connects to **Supabase** (Postgres), **MongoDB Atlas** (NoSQL), and **Upstash Redis** (Broker).

---

## 🤖 The AI/ML Pipeline

When a surveillance video is processed, it is routed through the multi-stage machine learning pipeline orchestrated by [video_processor.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/video_processor.py):

```
Raw Frame
  │
  ├──► [1. Ingestion] ──► OpenCV frame decimation / FFmpeg transcode
  │
  ├──► [2. Object Detection] ──► YOLOv8x (Person, Cars, Trucks, Motorcycles, Buses)
  │
  ├──► [3. Identity Tracking] ──► ByteTrack (Kalman Filter path correlation)
  │
  ├──► [4. Biometrics] ──► Haar Cascade face cropping ──► DeepFace FaceNet512 ──► FAISS Vector Search
  │
  ├──► [5. Behavioral Parsing] ──► Loitering, Tailgating, Sudden Speed Anomalies, Capacity Checks
  │
  ├──► [6. Risk Evaluation] ──► XGBoost Threat Classifier (8-Feature Vector)
  │
  └──► [7. GenAI Summarization] ──► LLM Provider Abstraction (Ollama / OpenAI / Gemini / OpenRouter)
```

### 1. Ingestion & Pre-processing
Uploaded videos are transcoding asynchronously in the background using `ffmpeg` to standard H.264 MP4 format with yuv420p pixel format, ensuring instant browser playback compatibility. OpenCV maps the metadata (`FPS`, `resolution`, `total frames`) to database records.

### 2. Multi-Class Object Detection
The pipeline runs the high-precision **YOLOv8x** model in [detector.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/detector.py) (68.2M parameters). It is optimized to detect:
* `person` (surveillance target)
* `car`, `truck`, `motorcycle`, `bus`, `bicycle` (vehicle monitoring)

### 3. Multi-Object Tracking (MOT)
The pipeline tracks objects continuously in [tracker.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/tracker.py) using the **ByteTrack** algorithm. It handles occlusion and tracking recovery by matching detection boxes across consecutive frames using Kalman Filters and Intersection-over-Union (IoU) mapping, assigning persistent IDs (e.g. `Person #3`).

### 4. Facial Recognition & Vector Search
To prevent background false positives, face recognition is run inside [face_recognizer.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/face_recognizer.py) exclusively on cropped head regions:
1. Crop bounding boxes of detected `person` entities, padded 15% upwards.
2. Locate faces using Haar Cascade classifiers.
3. Compute a 512-dimension face embedding using **DeepFace (FaceNet512)**.
4. Query the registered faces index via **FAISS** cosine similarity vector search.
5. If the similarity is above the calibration threshold (`0.40`), it assigns the registered name (e.g. `jd`) to the detection.
6. *Optimization:* Runs face recognition on the first frame a track is seen, repeating once every second only if the face remains unmatched.

### 5. Behavioral Analytics
The frame data is passed to [behavior_analyzer.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/behavior_analyzer.py), which evaluates 6 behavior markers:
* **Loitering:** Objects staying in a high-risk area longer than a configured duration.
* **Tailgating:** Two objects following each other with a spacing distance below `0.15` normalized frame units.
* **Sudden Movement Anomaly:** Frame-to-frame velocity spikes exceeding 250% of the moving average.
* **Crowd Formation:** An assembly of more than 5 persons in close proximity.
* **Zone Entry/Exit:** Polygon containment evaluation utilizing ray-casting algorithms in [zone_manager.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/zone_manager.py).
* **Zone Overcapacity:** Checking active occupancy against configured zone safety thresholds.

### 6. Machine Learning Threat Scoring
For every event, an **XGBoost classifier** (with a heuristic math fallback in [threat_scorer.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/ml/pipeline/threat_scorer.py)) computes an overall `threat_score` (0.0 to 1.0) using an 8-feature risk vector:
* `identity_confidence` (Biometric match certainty)
* `risk_level` (Identity registry threat rating: low/medium/high)
* `zone_risk` (Threat index of the bounding zone)
* `loitering_duration` (Time spent in target zone)
* `velocity_anomaly` (Speed spike coefficient)
* `visit_frequency` (How often this ID has been seen in past sessions)
* `concurrent_events` (Number of simultaneous alerts active)
* `behavior_count` (Number of behavioral warning flags triggered)

The threat score maps to 4 categories: `low` (green), `medium` (blue), `high` (orange), or `critical` (red).

### 7. GenAI Incident Narration
The platform includes an interchangeable **LLM Provider abstraction** in [genai_service.py](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/backend/app/services/genai_service.py) that allows operators to swap providers without changes to application code:
* **OpenAIProvider:** Connects to `gpt-4o` using the OpenAI SDK.
* **GeminiProvider:** Connects to Google's free developer tier `gemini-1.5-flash` model using direct REST requests (15 requests/min for free).
* **OpenRouterProvider:** Connects to OpenRouter's API endpoints using standard OpenAI bindings, allowing you to use free cloud models like `meta-llama/llama-3-8b-instruct:free` or `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`.
* **OllamaProvider:** Connects to a local `llama3` instance, allowing fully offline cloud-free operations.

---

## 🖥️ Platform Pages & Features Guide

### 1. Dashboard
* **Route:** `/`
* **Features:** Renders live metric cards (Active Feeds, Today's Events, Critical Alerts, Average Threat Score). Includes historical event counts over the last 24 hours, real-time alert logs connected to reactive WebSockets, and database event logs mapped to custom severity gauges.

### 2. Video Intelligence
* **Route:** `/video`
* **Features:**
  * **Upload & Transcode:** Drag-and-drop video uploads that transcode asynchronously in the background.
  * **Tactical Human Tracer:** Draws a Foot Ellipse Scanner, Center Target Crosshair, and a 3-second motion history tracer on human detections.
  * **Interactive Scrubber:** Custom Orange-Glowing seek bar that updates the H:M:S playback timer on scrubber scrape.
  * **Speed Controls:** Adjust playback rate slider from slow-motion (`0.25x`) to fast-forward (`4.0x`).
  * **Frame Seek:** Click `F-` and `F+` buttons to step backwards/forwards single frames (1/30th of a second).
  * **AI Sensitivity Slider:** Adjust confidence threshold from 10% to 90% prior to starting the AI pipeline.

### 3. Live Camera Grid
* **Route:** `/cameras`
* **Features:** Monitor up to 16 channels simultaneously. Supports multiple layouts (`1x1`, `2x2`, `3x2`, `3x3`, `4x4`, `1+3` Featured). Feed sources can be local PC Webcams, custom video loops, or external RTSP/HLS streams. Automatically pages camera channels and includes real-time YOLO bounding box overlays.

### 4. Zone Intelligence
* **Route:** `/zones`
* **Features:** Create and draw polygon safety zones on video layers. Save custom names, colors, capacity limits, and threat factors to the database. Includes a sidebar showing real-time occupancy counts and daily alert triggers per zone.

### 5. Trajectory Analysis & Heatmaps
* **Route:** `/trajectory`
* **Features:** 
  * **Path Visualizer:** Renders movement paths of persistent identities, complete with direction arrows, color gradients, and threat scores.
  * **Heatmap Overlay:** Toggles a density heatmap of detections showing physical loitering hotspots on the video frame.

### 6. Evidence Snapshots
* **Route:** `/evidence`
* **Features:** Scrape frames from surveillance videos. OpenCV captures exact timestamps on disk and registers them to a file gallery. Supports immediate high-quality image downloads for investigation reports.

### 7. Incident Center & Reports
* **Route:** `/incidents` & `/reports`
* **Features:** 
  * Review AI-narrated incident logs.
  * Download professional `.docx` incident reports containing the event details, threat scores, and recommended actions.
  * Export event and audit logs to CSV.
  * View executive Daily briefings pre-warmed by LLM providers.

---

## 🛠️ Technology Stack

### Frontend
* **Core:** React 18, Vite, TypeScript
* **State Management:** Zustand
* **Query Caching:** React Query (TanStack Query)
* **Styling:** Vanilla CSS, TailwindCSS (for utility layout frames)
* **Icons & Animation:** Lucide React, Framer Motion
* **Charts:** Recharts

### Backend
* **Core:** FastAPI (Python 3.11), Uvicorn, Celery
* **SQL ORM:** SQLAlchemy (Asyncio)
* **NoSQL Client:** PyMongo / Motor (Asyncio)
* **HTTP Client:** HTTPX, AioHTTP
* **Logging:** Structlog

### Infrastructure & Operations
* **Message Broker:** Redis / Upstash Redis
* **Time-Series DB:** PostgreSQL + TimescaleDB
* **Document DB:** MongoDB / MongoDB Atlas
* **Web Server:** Nginx (Reverse Proxy)

---

## 🚀 Setup & Launch

### Option A: Local Run (Docker Compose)

#### Prerequisites
* Docker and Docker Desktop installed.
* NVIDIA Container Toolkit (Optional: for CUDA acceleration on local YOLO runs).

#### 1. Clone and Configure
```bash
git clone https://github.com/Kev-seb/AI-Powered-Surveillance-Intelligence-Platform.git
cd AI-Powered-Surveillance-Intelligence-Platform
cp .env.example .env
```
*(The default values in `.env` are configured to launch PostgreSQL, MongoDB, Redis, and Nginx locally out of the box).*

#### 2. Run standard docker-compose
```bash
docker compose up --build
```

#### 3. Setup local Llama3
```bash
docker exec -it asip_ollama ollama pull llama3
```

#### 4. Access URLs
* **Frontend Dashboard:** `http://localhost:3000`
* **API Documentation:** `http://localhost:8000/api/docs`
* **Default Credentials:** `admin` / `Admin@1234`

---

### Option B: Cloud Deployment (HF Spaces + Vercel)

This project is optimized to run fully in the cloud using serverless databases:
* **Database:** Supabase PostgreSQL (Port `5432` Session mode).
* **Document DB:** MongoDB Atlas Cluster.
* **Cache & Broker:** Upstash Redis (Database `0` is mandatory).

#### 1. Setup Backend on Hugging Face Spaces
1. Create a new Space on [Hugging Face](https://huggingface.co/) selecting **Docker** template (Blank).
2. Push the files in the [hf-backend](file:///d:/AI%20Powered%20Surveillance%20Intelligence%20Platform/hf-backend/) directory to the space.
3. Configure the following variables and secrets in your Space Settings:

## Environment Variables

Create the following secrets/variables in your Hugging Face Space:

| Name | Type | Example |
|--------|--------|---------|
| DATABASE_URL | Secret | postgresql+asyncpg://... |
| MONGO_URL | Secret | mongodb+srv://... |
| REDIS_URL | Secret | rediss://... |
| CELERY_BROKER_URL | Secret | rediss://... |
| CELERY_RESULT_BACKEND | Secret | rediss://... |
| OPENROUTER_API_KEY | Secret | sk-or-v1-... |
| OPENROUTER_MODEL | Variable | nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free |
| SECRET_KEY | Secret | your-jwt-secret-key |
| ENVIRONMENT | Variable | production |

*Note: In MongoDB Atlas, you must go to **Network Access** and select **Allow Access From Anywhere** (`0.0.0.0/0`) so Hugging Face's dynamic cloud IP range isn't blocked by the TLS handshake.*

#### 2. Deploy Frontend on Vercel
1. Import your frontend folder from your GitHub repository to [Vercel](https://vercel.com).
2. Set **Root Directory** to `frontend`.
3. Set **Framework Preset** to `Vite`.
4. Configure the following environment variable in the Vercel project settings:
   * **Key:** `VITE_API_URL`
   * **Value:** `https://your-space-name.hf.space` (Your public Hugging Face Space URL)
5. Deploy! Vercel will automatically build the site, compile TypeScript definitions via `vite-env.d.ts`, and apply `vercel.json` rewrites for routing.

---

## 🎯 Value Proposition & Future Roadmap

### Why This Project Exists
Modern surveillance systems generate massive quantities of raw, unindexed video. Security teams face **information overload**, spending hours scrubbing footage manually. 

**ASIP** automates this by:
1. Transforming raw pixels into structured, queryable document feeds (events, locations, identities, velocity anomaly vectors).
2. Reducing human fatigue by filtering static noise (99.9% of CCTV footage contains no actionable incidents) and flagging only anomalies.
3. Automatically writing incident narratives, saving operators from compiling reports manually during critical events.

### Future Roadmap
1. **Multi-Modal VLM Querying:** Integrate vision-language models (e.g. Gemini 1.5 Flash video inputs) to allow operators to search footage using natural language (e.g., *"Show me anyone carrying a red backpack near the parking lot after 5 PM"*).
2. **Edge Hardware Acceleration:** Compile the detection, tracker, and face recognition modules to **ONNX Runtime** and **NVIDIA TensorRT** to maximize pipeline FPS on low-power edge gateways.
3. **Audio Anomaly Integration:** Add sound threshold sensors to capture and log audio anomalies (gunshots, shattering glass, screaming) directly into the alert timeline.
4. **Federated Multi-Site Orchestration:** Scale the Celery broker to ingest metadata streams from dozens of distinct physical site gateways, merging them into a unified cloud-native operational dashboard.

---

*Built with ❤️ by the ASIP Development Team*
