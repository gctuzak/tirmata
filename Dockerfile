# Stage 1: Frontend Build
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend Build and Runtime
FROM python:3.11-slim
WORKDIR /app

# USB Yazıcı desteği için gerekli paketlerin (CUPS/lpr) kurulması
RUN apt-get update && apt-get install -y cups-client lpr && rm -rf /var/lib/apt/lists/*

# Python gereksinimlerinin yüklenmesi
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Uygulama kodlarının kopyalanması
COPY . .

# Derlenmiş frontend dosyalarının kopyalanması
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Veritabanı için klasör oluşturulması
RUN mkdir -p /app/data

# Çevresel değişkenler
ENV RESTAURANT_DB_PATH=/app/data/restaurant.db

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
