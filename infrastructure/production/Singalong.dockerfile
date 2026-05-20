FROM node:22-alpine AS admin-builder

WORKDIR /build/admin

COPY apps/singalong-admin/package*.json /build/admin/
RUN npm install

COPY apps/singalong-admin /build/admin
ENV VITE_BASE_PATH=/admin/
RUN npm run build


FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ADMIN_STATIC_DIR=/app/static/admin

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY apps/singalong-backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

COPY apps/singalong-backend /app
COPY --from=admin-builder /build/admin/dist /app/static/admin

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
