#!/bin/bash

# Start FastAPI app
echo "Starting FastAPI App on port ${PORT:-7860}..."
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --loop uvloop &
FASTAPI_PID=$!

# Start Celery worker
echo "Starting Celery Worker..."
celery -A app.tasks.celery_app worker --loglevel=info --concurrency=1 -Q video_processing,report_generation &
CELERY_PID=$!

# Wait for either process to exit
wait -n

# Exit with status of the one that failed
exit $?
