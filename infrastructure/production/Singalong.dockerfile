FROM node:22-alpine AS client-builder

WORKDIR /build/client

ARG VITE_SINGALONG_BASE_URL

COPY apps/singalong-client/package*.json /build/client/
RUN npm install

COPY apps/singalong-client /build/client
ENV VITE_BASE_PATH=/client/
ENV VITE_SINGALONG_BASE_URL=${VITE_SINGALONG_BASE_URL}
RUN npm run build


FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CLIENT_STATIC_DIR=/app/static/client

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY apps/singalong-backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

COPY apps/singalong-backend /app
COPY --from=client-builder /build/client/dist /app/static/client

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
